import type { Profile } from "./supabase";

export function profileLabel(profile?: Pick<Profile, "full_name" | "username" | "email"> | null) {
  if (!profile) return "—";
  return profile.full_name || profile.username || profile.email || "—";
}

export function profilesWithSelf(profiles: Profile[], self: Profile | null) {
  if (!self || profiles.some((profile) => profile.id === self.id)) return profiles;
  return [self, ...profiles];
}

export function ancestorChain(userId: string, profiles: Profile[]) {
  const chain: Profile[] = [];
  const seen = new Set<string>();
  let current = profiles.find((profile) => profile.id === userId);
  while (current && !seen.has(current.id)) {
    chain.push(current);
    seen.add(current.id);
    current = current.parent_id ? profiles.find((profile) => profile.id === current?.parent_id) : undefined;
  }
  return chain;
}

export function belongsToNetwork(userId: string, ancestorId: string, profiles: Profile[]) {
  return ancestorChain(userId, profiles).some((profile) => profile.id === ancestorId);
}

function roleName(role: string) {
  return role === "sub_mitra" ? "submitra" : role;
}

export function accountInNetwork(caller: Profile, row: Profile, profiles: Profile[]) {
  if (row.id === caller.id) return true;
  const callerRole = roleName(caller.role);
  if (callerRole === "super_admin") return true;
  if (callerRole === "mitra") {
    if (row.parent_id === caller.id || row.created_by === caller.id || row.mitra_id === caller.id) return true;
    const parent = row.parent_id ? profiles.find((item) => item.id === row.parent_id) : undefined;
    if (parent && (parent.parent_id === caller.id || parent.created_by === caller.id || parent.mitra_id === caller.id || parent.id === caller.id)) return true;
    const creator = row.created_by ? profiles.find((item) => item.id === row.created_by) : undefined;
    return !!creator && (creator.parent_id === caller.id || creator.mitra_id === caller.id || creator.id === caller.id);
  }
  if (callerRole === "submitra") return row.parent_id === caller.id || row.created_by === caller.id;
  return false;
}

export function networkAccountIds(caller: Profile, profiles: Profile[]) {
  return profiles.filter((row) => accountInNetwork(caller, row, profiles)).map((row) => row.id);
}

export function networkOwners(userId: string, profiles: Profile[]) {
  const chain = ancestorChain(userId, profiles);
  const roleOf = (profile: Profile) => {
    const role = profile.role as string;
    return role === "sub_mitra" ? "submitra" : role;
  };
  return {
    account: chain[0] ?? null,
    submitra: chain.find((profile) => roleOf(profile) === "submitra") ?? null,
    mitra: chain.find((profile) => roleOf(profile) === "mitra") ?? null,
  };
}
