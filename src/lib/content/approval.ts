// Content approval policy (Business.contentApproval). Pure.
//
//   auto            no approval for one-person teams; admins approve for teams
//   none            anyone can schedule; nothing waits for approval
//   admins_approve  members' posts wait for an admin; admins' posts go straight out
//   always          every post waits for an explicit Approve, even an admin's

export const APPROVAL_POLICIES = ["auto", "none", "admins_approve", "always"] as const;
export type ApprovalPolicy = (typeof APPROVAL_POLICIES)[number];

export const APPROVAL_POLICY_LABEL: Record<ApprovalPolicy, string> = {
  auto: "Automatic (approval only for teams)",
  none: "No approval",
  admins_approve: "Admins approve members' posts",
  always: "Every post needs an admin's approval",
};

export function normalizePolicy(v: string | null | undefined): ApprovalPolicy {
  return (APPROVAL_POLICIES as readonly string[]).includes(v ?? "") ? (v as ApprovalPolicy) : "auto";
}

/** Does publishing need an approved post at all? */
export function approvalRequired(policy: ApprovalPolicy, teamSize: number): boolean {
  if (policy === "none") return false;
  if (policy === "auto") return teamSize > 1;
  return true;
}

/** May this person's scheduling count as the approval? */
export function canSelfApprove(policy: ApprovalPolicy, role: string): boolean {
  if (policy === "always") return false;
  return role === "admin";
}

export type ScheduleDecision = "schedule" | "approve_and_schedule" | "needs_approval";

/** What scheduling a post does, given the policy, who is scheduling and the post's state. */
export function scheduleDecision(args: { policy: ApprovalPolicy; teamSize: number; role: string; postApproved: boolean }): ScheduleDecision {
  if (!approvalRequired(args.policy, args.teamSize)) return "schedule";
  if (args.postApproved) return "schedule";
  if (canSelfApprove(args.policy, args.role)) return "approve_and_schedule";
  return "needs_approval";
}
