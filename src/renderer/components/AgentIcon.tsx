import React from 'react'

const agentSvgs: Record<string, string> = {
  codex: 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z',
  claude: 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z',
  hermes: 'M12 2L2 7l10 5 10-5-10-5z M2 17l10 5 10-5 M2 12l10 5 10-5',
  openclaw: 'M12 3c-4.97 0-9 4.03-9 9s4.03 9 9 9 9-4.03 9-9-4.03-9-9-9z',
  default: 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z'
}
interface AgentIconProps {
  agentId: string;
  size?: number;
  className?: string;
}

export function AgentIcon({ agentId, size = 32, className = '' }: AgentIconProps) {
  const id = agentId.toLowerCase().replace(/\s/g, '');
  const pathData = agentSvgs[id] || agentSvgs.default;
  return (
    <svg
      width={size}
      height={size}
      viewBox='0 0 24 24'
      fill='currentColor'
      className={className}
    >
      <path d={pathData} />
    </svg>
  );
}

export function getAgentIconPath(agentId: string): string {
  const id = agentId.toLowerCase();
  return id === 'codex' || id === 'claude' || id === 'hermes' || id === 'openclaw' || id === 'openai'
    ? './icons/' + id + '.svg'
    : './icons/default.svg';
}