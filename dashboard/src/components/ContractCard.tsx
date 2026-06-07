import { useEffect, useRef, useState } from "react";
import { FileText, Save, RotateCcw } from "lucide-react";
import type { Contract } from "../types";
import type { HubActions } from "../api";
import { nameOf, timeAgo } from "../util";
import type { Agent } from "../types";

export function ContractCard({
  contract,
  agents,
  actions,
}: {
  contract: Contract;
  agents: Agent[];
  actions: HubActions;
}) {
  const [api, setApi] = useState(contract.apiContract);
  const [design, setDesign] = useState(contract.designSpec);
  const base = useRef({ api: contract.apiContract, design: contract.designSpec, version: contract.version });
  const [stale, setStale] = useState(false);
  const [saving, setSaving] = useState(false);

  const dirty = api !== base.current.api || design !== base.current.design;

  // External update arrived. If we have no local edits, adopt it; otherwise flag stale.
  useEffect(() => {
    if (contract.version === base.current.version) return;
    const localDirty = api !== base.current.api || design !== base.current.design;
    if (!localDirty) {
      setApi(contract.apiContract);
      setDesign(contract.designSpec);
      base.current = { api: contract.apiContract, design: contract.designSpec, version: contract.version };
      setStale(false);
    } else {
      setStale(true);
    }
  }, [contract.version, contract.apiContract, contract.designSpec, api, design]);

  const reload = () => {
    setApi(contract.apiContract);
    setDesign(contract.designSpec);
    base.current = { api: contract.apiContract, design: contract.designSpec, version: contract.version };
    setStale(false);
  };

  const save = async () => {
    setSaving(true);
    const ok = await actions.updateContract({ apiContract: api, designSpec: design, expectedVersion: base.current.version });
    setSaving(false);
    if (!ok) setStale(true);
  };

  return (
    <section className="card">
      <div className="card-head">
        <FileText size={15} className="text-[var(--accent)]" />
        <span className="card-title">共享约定</span>
        <span className="chip ml-1 bg-white/5 text-[var(--muted-2)]">v{contract.version}</span>
        {contract.updatedAt > 0 && (
          <span className="text-[11px] text-[var(--muted)]">
            {nameOf(agents, contract.updatedBy)} · {timeAgo(contract.updatedAt)}
          </span>
        )}
        <div className="ml-auto flex items-center gap-2">
          {stale && (
            <button className="btn btn-danger flex items-center gap-1 py-1.5" onClick={reload}>
              <RotateCcw size={12} /> 已被更新，载入最新
            </button>
          )}
          <button
            className="btn btn-primary flex items-center gap-1.5 py-1.5 disabled:opacity-40"
            onClick={() => void save()}
            disabled={!dirty || saving}
          >
            <Save size={13} /> {saving ? "保存中…" : "保存约定"}
          </button>
        </div>
      </div>
      <div className="card-body grid min-h-0 flex-1 grid-rows-2 gap-3">
        <div className="flex min-h-0 flex-col">
          <label className="mb-1.5 text-[12px] font-medium text-[var(--muted-2)]">接口契约（两边都按这个对接口）</label>
          <textarea
            className="textarea min-h-0 flex-1"
            placeholder="例如：&#10;GET /users -> [{ id, name, email }]&#10;POST /users { name, email } -> { id, name, email }"
            value={api}
            onChange={(e) => setApi(e.target.value)}
          />
        </div>
        <div className="flex min-h-0 flex-col">
          <label className="mb-1.5 text-[12px] font-medium text-[var(--muted-2)]">设计规范（保证两边 UI 风格一致）</label>
          <textarea
            className="textarea min-h-0 flex-1"
            placeholder="例如：&#10;主色 #5b8cff；危险色 #ff6b81&#10;字体 思源黑体；圆角 12px；间距 8 的倍数&#10;组件库 shadcn/ui；图标 lucide"
            value={design}
            onChange={(e) => setDesign(e.target.value)}
          />
        </div>
      </div>
    </section>
  );
}
