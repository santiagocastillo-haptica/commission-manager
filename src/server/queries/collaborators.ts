import { loadAllProjects, loadCollaboratorDocs, loadPolicyDocs } from "../repo";
import type { CollaboratorDoc, PolicyDoc, ProjectDoc } from "@/store";

export interface CollaboratorRow {
  id: string;
  fullName: string;
  email: string;
  position: string;
  status: "ACTIVE" | "INACTIVE";
  policyId: string;
  policyCode: string;
  policyName: string;
  joinDate: string | null;
  notes: string | null;
  projectCount: number;
}

function toRow(c: CollaboratorDoc, policies: Map<string, PolicyDoc>, projects: ProjectDoc[]): CollaboratorRow {
  const policy = policies.get(c.policyId);
  return {
    id: c.id,
    fullName: c.fullName,
    email: c.email,
    position: c.position,
    status: c.status,
    policyId: c.policyId,
    policyCode: policy?.code ?? c.policyId,
    policyName: policy?.name ?? c.policyId,
    joinDate: c.joinDate,
    notes: c.notes,
    projectCount: projects.filter((p) => !p.voidedAt && p.collaboratorIds.includes(c.id)).length,
  };
}

export async function listCollaborators(): Promise<CollaboratorRow[]> {
  const [docs, policies, projects] = await Promise.all([loadCollaboratorDocs(), loadPolicyDocs(), loadAllProjects()]);
  const byPolicy = new Map(policies.map((p) => [p.id, p]));
  return docs
    .map((c) => toRow(c, byPolicy, projects))
    .sort((a, b) => (a.status === b.status ? a.fullName.localeCompare(b.fullName, "es") : a.status === "ACTIVE" ? -1 : 1));
}

export async function getCollaborator(id: string): Promise<CollaboratorRow | null> {
  return (await listCollaborators()).find((c) => c.id === id) ?? null;
}

export async function listPolicies(): Promise<{ id: string; code: string; name: string; kind: PolicyDoc["kind"] }[]> {
  return (await loadPolicyDocs()).map((p) => ({ id: p.id, code: p.code, name: p.name, kind: p.kind })).sort((a, b) => a.code.localeCompare(b.code));
}
