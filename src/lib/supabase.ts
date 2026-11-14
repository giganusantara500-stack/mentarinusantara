import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error("Supabase URL atau anon key belum dikonfigurasi di .env");
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});

export type AppRole = "pending" | "super_admin" | "mitra" | "submitra" | "loket";

export interface Profile {
  id: string;
  email: string;
  full_name: string;
  username: string | null;
  phone: string | null;
  business_name: string | null;
  address: string | null;
  city: string | null;
  role: AppRole;
  parent_id: string | null;
  status: "pending" | "active" | "suspended";
  must_change_password: boolean;
  loket_type: string | null;
  loket_code: string | null;
  deleted_at: string | null;
  last_login_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}
