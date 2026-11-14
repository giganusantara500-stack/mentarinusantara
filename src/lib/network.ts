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
