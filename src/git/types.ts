import type { CommitType } from "../shared/types.ts";

export interface GitLogEntry {
  hash: string;
  message: string;
  timestamp: number;
  filesChanged: string[];
}

export interface GitStatus {
  staged: string[];
  modified: string[];
  untracked: string[];
}

export interface GitManager {
  init(): Promise<void>;
  commit(message: string, type: CommitType): Promise<string>;
  log(limit?: number): Promise<GitLogEntry[]>;
  diff(filePath?: string): Promise<string>;
  getFileAtCommit(filePath: string, commitHash: string): Promise<string>;
  status(): Promise<GitStatus>;
  isInitialized(): Promise<boolean>;
}
