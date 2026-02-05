import fs from "node:fs";
import { join } from "node:path";
import * as git from "isomorphic-git";
import type { MemoryConfig } from "../shared/config.ts";
import type { CommitType } from "../shared/types.ts";
import type { GitLogEntry, GitManager, GitStatus } from "./types.ts";

export function createGitManager(config: MemoryConfig): GitManager {
  const dir = config.baseDir;

  return {
    async init(): Promise<void> {
      await git.init({ fs, dir, defaultBranch: "main" });
    },

    async commit(message: string, type: CommitType): Promise<string> {
      const formattedMessage = `[${type}] ${message}`;

      // Get status matrix to find all changes
      const matrix = await git.statusMatrix({ fs, dir, cache: {} });

      // Process each file in the status matrix
      for (const [filepath, headStatus, workdirStatus, stageStatus] of matrix) {
        // Skip if file is already staged and up to date
        if (headStatus === 1 && workdirStatus === 1 && stageStatus === 1) {
          continue;
        }

        // File deleted in working directory
        if (workdirStatus === 0) {
          await git.remove({ fs, dir, filepath });
        }
        // File exists in working directory (new, modified, or needs staging)
        else if (
          workdirStatus === 2 ||
          (headStatus === 0 && workdirStatus === 1)
        ) {
          await git.add({ fs, dir, filepath });
        }
      }

      // Create the commit
      const sha = await git.commit({
        fs,
        dir,
        message: formattedMessage,
        author: {
          name: "Agent Memory",
          email: "agent@local",
        },
      });

      return sha;
    },

    async log(limit?: number): Promise<GitLogEntry[]> {
      try {
        const commits = await git.log({
          fs,
          dir,
          depth: limit,
        });

        return Promise.all(
          commits.map(async (commit) => {
            const filesChanged: string[] = [];

            // Get files changed in this commit by comparing with parent
            const parentOid = commit.commit.parent?.[0];
            if (parentOid) {
              try {
                const tree1 = await git.readTree({ fs, dir, oid: parentOid });
                const tree2 = await git.readTree({ fs, dir, oid: commit.oid });

                // Build sets of file paths
                const tree1Files = new Set(
                  tree1.tree.map((entry) => entry.path),
                );
                const tree2Files = new Set(
                  tree2.tree.map((entry) => entry.path),
                );

                // Files in tree2 but not tree1 (added)
                for (const entry of tree2.tree) {
                  if (!tree1Files.has(entry.path)) {
                    filesChanged.push(entry.path);
                  }
                }

                // Files in tree1 but not tree2 (deleted)
                for (const entry of tree1.tree) {
                  if (!tree2Files.has(entry.path)) {
                    filesChanged.push(entry.path);
                  }
                }

                // Files in both trees (check if modified)
                for (const entry of tree2.tree) {
                  if (tree1Files.has(entry.path)) {
                    const tree1Entry = tree1.tree.find(
                      (e) => e.path === entry.path,
                    );
                    if (tree1Entry && tree1Entry.oid !== entry.oid) {
                      filesChanged.push(entry.path);
                    }
                  }
                }
              } catch (error) {
                // If we can't read parent tree, just leave filesChanged empty
              }
            } else {
              // Initial commit - all files are new
              try {
                const tree = await git.readTree({ fs, dir, oid: commit.oid });
                filesChanged.push(...tree.tree.map((entry) => entry.path));
              } catch (error) {
                // Leave filesChanged empty on error
              }
            }

            return {
              hash: commit.oid,
              message: commit.commit.message.trim(),
              timestamp: commit.commit.author.timestamp,
              filesChanged,
            };
          }),
        );
      } catch (error) {
        // Empty repository - no commits yet
        if (
          error instanceof Error &&
          error.message.includes("Could not find")
        ) {
          return [];
        }
        throw error;
      }
    },

    async diff(filePath?: string): Promise<string> {
      const matrix = await git.statusMatrix({
        fs,
        dir,
        ...(filePath ? { filepaths: [filePath] } : {}),
        cache: {},
      });
      const diffLines: string[] = [];

      // Resolve HEAD to actual commit hash
      let headCommit: string | undefined;
      try {
        headCommit = await git.resolveRef({ fs, dir, ref: "HEAD" });
      } catch {
        // No HEAD yet (empty repository)
        headCommit = undefined;
      }

      for (const [filepath, headStatus, workdirStatus, stageStatus] of matrix) {
        // Skip unchanged files (1=present in head, 1=present unchanged in workdir, 1=present unchanged in stage)
        if (headStatus === 1 && workdirStatus === 1 && stageStatus === 1) {
          continue;
        }

        // File deleted in working directory
        if (workdirStatus === 0 && headStatus === 1 && headCommit) {
          diffLines.push(`--- ${filepath} (deleted)`);
          try {
            const headBlob = await git.readBlob({
              fs,
              dir,
              oid: headCommit,
              filepath,
            });
            const headContent = new TextDecoder().decode(headBlob.blob);
            const headLines = headContent.split("\n");
            for (const line of headLines) {
              diffLines.push(`- ${line}`);
            }
          } catch (error) {
            // Skip if can't read HEAD version
          }
          diffLines.push("");
        }
        // New file (not in HEAD, exists in workdir)
        else if (headStatus === 0 && workdirStatus > 0) {
          diffLines.push(`+++ ${filepath} (new file)`);
          try {
            const workdirContent = await fs.promises.readFile(
              join(dir, filepath),
              "utf-8",
            );
            const workdirLines = workdirContent.split("\n");
            for (const line of workdirLines) {
              diffLines.push(`+ ${line}`);
            }
          } catch (error) {
            // Skip if can't read file
          }
          diffLines.push("");
        }
        // Modified file (workdir=2 means modified)
        else if (headStatus === 1 && workdirStatus === 2 && headCommit) {
          diffLines.push(`*** ${filepath} (modified)`);
          try {
            const headBlob = await git.readBlob({
              fs,
              dir,
              oid: headCommit,
              filepath,
            });
            const headContent = new TextDecoder().decode(headBlob.blob);
            const workdirContent = await fs.promises.readFile(
              join(dir, filepath),
              "utf-8",
            );

            const headLines = headContent.split("\n");
            const workdirLines = workdirContent.split("\n");

            // Simple line-by-line diff
            const maxLines = Math.max(headLines.length, workdirLines.length);
            for (let i = 0; i < maxLines; i++) {
              const headLine = headLines[i] ?? "";
              const workdirLine = workdirLines[i] ?? "";

              if (headLine !== workdirLine) {
                if (headLine) {
                  diffLines.push(`- ${headLine}`);
                }
                if (workdirLine) {
                  diffLines.push(`+ ${workdirLine}`);
                }
              }
            }
          } catch (error) {
            // Skip if can't read versions
          }
          diffLines.push("");
        }
      }

      return diffLines.join("\n").trim();
    },

    async getFileAtCommit(
      filePath: string,
      commitHash: string,
    ): Promise<string> {
      const blob = await git.readBlob({
        fs,
        dir,
        oid: commitHash,
        filepath: filePath,
      });
      return new TextDecoder().decode(blob.blob);
    },

    async status(): Promise<GitStatus> {
      const matrix = await git.statusMatrix({ fs, dir, cache: {} });

      const staged: string[] = [];
      const modified: string[] = [];
      const untracked: string[] = [];

      for (const [filepath, headStatus, workdirStatus, stageStatus] of matrix) {
        // Status matrix values:
        // HEAD: 0=absent, 1=present
        // WORKDIR: 0=absent, 1=present-identical, 2=present-different
        // STAGE: 0=absent, 1=present-identical, 2=present-different, 3=present-different-again

        // Untracked: not in HEAD, not in stage, exists in workdir
        if (headStatus === 0 && stageStatus === 0 && workdirStatus > 0) {
          untracked.push(filepath);
        }
        // Staged for addition: not in HEAD, but in stage
        else if (headStatus === 0 && stageStatus > 0) {
          staged.push(filepath);
        }
        // Staged for deletion: in HEAD, not in workdir, not in stage
        else if (headStatus === 1 && workdirStatus === 0 && stageStatus === 0) {
          staged.push(filepath);
        }
        // Staged modification: stage differs from head
        else if (headStatus === 1 && stageStatus === 2) {
          staged.push(filepath);
        }
        // Modified but not staged: workdir different from HEAD/stage
        else if (headStatus === 1 && workdirStatus === 2 && stageStatus === 1) {
          modified.push(filepath);
        }
        // Deleted but not staged: in HEAD, not in workdir, still in stage as present
        else if (headStatus === 1 && workdirStatus === 0 && stageStatus === 1) {
          modified.push(filepath);
        }
      }

      return { staged, modified, untracked };
    },

    async isInitialized(): Promise<boolean> {
      try {
        const gitDir = join(dir, ".git");
        await fs.promises.access(gitDir);
        return true;
      } catch {
        return false;
      }
    },
  };
}
