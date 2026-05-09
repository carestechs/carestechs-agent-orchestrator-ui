export type AgentNodeKind = 'local' | 'human' | 'remote';

export interface AgentNode {
  name: string;
  kind: AgentNodeKind;
}

export interface Agent {
  ref: string;
  description: string;
  nodes: AgentNode[];
}
