import { FileCode2, FilePlus2, Minus, Plus } from "lucide-react";
import type { WorktreeDiff } from "../types";

export function DiffSummary({ diff }: { diff: WorktreeDiff }) {
  return (
    <div className="diff-summary">
      <div className="diff-stats">
        <span className="diff-stat">
          <FileCode2 size={14} />
          {diff.filesChanged} 个文件变更
        </span>
        <span className="diff-stat addition">
          <Plus size={14} />
          {diff.insertions}
        </span>
        <span className="diff-stat deletion">
          <Minus size={14} />
          {diff.deletions}
        </span>
      </div>

      <div className="diff-file-list">
        {diff.files.map((f) => (
          <div key={f.path} className="diff-file-row">
            <FileCode2 size={13} />
            <span className="diff-file-path">{f.path}</span>
            {f.binary ? (
              <span className="diff-file-binary">[binary]</span>
            ) : (
              <span className="diff-file-nums">
                {f.added !== null && <span className="addition">+{f.added}</span>}
                {f.deleted !== null && <span className="deletion">-{f.deleted}</span>}
              </span>
            )}
          </div>
        ))}
        {diff.untracked.map((path) => (
          <div key={path} className="diff-file-row untracked">
            <FilePlus2 size={13} />
            <span className="diff-file-path">{path}</span>
            <span className="diff-file-new">new</span>
          </div>
        ))}
      </div>
    </div>
  );
}
