import { useState } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth, dbRoleToAppRole } from "@/lib/auth";
import { useAnnouncements, type AnnouncementRow } from "@/lib/hooks";
import { PageContainer } from "@/components/PageContainer";
import { PageHeader } from "@/components/ui/Common";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Field, Input, Select, Textarea } from "@/components/ui/Form";
import { formatTanggal } from "@/lib/format";
import { ROLE_LABELS } from "@/lib/nav";
import { Megaphone, Pin, Plus, Pencil, Trash2, AlertCircle } from "lucide-react";

const audienceLabel: Record<string, string> = {
  all: "Semua pengguna",
  super_admin: "Super Admin",
  mitra: "Mitra",
  submitra: "Sub Mitra",
  loket: "Loket",
};

export function AnnouncementsPage() {
  const { profile, isSuperAdmin } = useAuth();
  const { announcements, loading, refresh } = useAnnouncements();
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<AnnouncementRow | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ title: "", body: "", audience: "all", pinned: false });

  if (!profile) return null;
  const canManage = isSuperAdmin;

  const openAdd = () => {
    setForm({ title: "", body: "", audience: "all", pinned: false });
    setShowForm(true);
    setError("");
  };
  const openEdit = (a: AnnouncementRow) => {
    setForm({ title: a.title, body: a.body, audience: a.audience, pinned: a.pinned });
    setEditing(a);
    setError("");
  };

  const save = async () => {
    if (!form.title || !form.body) { setError("Judul dan isi wajib diisi"); return; }
    setBusy(true);
    setError("");
    const { error: rpcErr } = await supabase.rpc("admin_manage_announcement", {
      p_action: editing ? "update" : "create",
      p_announcement_id: editing?.id ?? null,
      p_title: form.title,
      p_body: form.body,
      p_audience: form.audience,
      p_pinned: form.pinned,
    });
    setBusy(false);
    if (rpcErr) { setError(rpcErr.message); return; }
    setEditing(null);
    setShowForm(false);
    refresh();
  };

  const remove = async (a: AnnouncementRow) => {
    if (!confirm("Hapus pengumuman ini?")) return;
    const { error: rpcErr } = await supabase.rpc("admin_manage_announcement", {
      p_action: "delete",
      p_announcement_id: a.id,
    });
    if (rpcErr) { alert(rpcErr.message); return; }
    refresh();
  };

  const togglePin = async (a: AnnouncementRow) => {
    const { error: rpcErr } = await supabase.rpc("admin_manage_announcement", {
      p_action: "toggle_pin",
      p_announcement_id: a.id,
    });
    if (rpcErr) { alert(rpcErr.message); return; }
    refresh();
  };

  return (
    <PageContainer>
      <PageHeader title="Pengumuman" description={canManage ? "Kelola pengumuman untuk seluruh jaringan." : "Pengumuman dari Super Admin."}>
        {canManage && <Button onClick={openAdd}><Plus size={16} /> Buat Pengumuman</Button>}
      </PageHeader>

      <div className="space-y-4">
        {loading && <Card className="p-10 text-center"><p className="text-sm text-slate-500">Memuat pengumuman...</p></Card>}
        {!loading && announcements.length === 0 && (
          <Card className="p-10 text-center">
            <Megaphone size={28} className="mx-auto text-slate-300 mb-2" />
            <p className="text-sm text-slate-500">Belum ada pengumuman.</p>
          </Card>
        )}
        {announcements.map((a) => (
          <Card key={a.id} className="overflow-hidden">
            <div className="p-5">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-2">
                  <div className="w-9 h-9 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center">
                    <Megaphone size={18} />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="text-sm font-semibold text-slate-900">{a.title}</h3>
                      {a.pinned && <Badge tone="info"><Pin size={10} /> Disematkan</Badge>}
                    </div>
                    <div className="text-xs text-slate-500 mt-0.5">
                      {formatTanggal(a.created_at)} • Untuk: {audienceLabel[a.audience] || a.audience}
                    </div>
                  </div>
                </div>
                {canManage && (
                  <div className="flex items-center gap-1">
                    <button onClick={() => togglePin(a)} className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 hover:text-blue-600" title="Sematkan">
                      <Pin size={15} />
                    </button>
                    <button onClick={() => openEdit(a)} className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 hover:text-blue-600"><Pencil size={15} /></button>
                    <button onClick={() => remove(a)} className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 hover:text-rose-600"><Trash2 size={15} /></button>
                  </div>
                )}
              </div>
              <p className="text-sm text-slate-700 leading-relaxed mt-3 whitespace-pre-wrap">{a.body}</p>
            </div>
          </Card>
        ))}
      </div>

      <Modal
        open={showForm || !!editing}
        onClose={() => { setShowForm(false); setEditing(null); setError(""); }}
        title={editing ? "Edit Pengumuman" : "Buat Pengumuman"}
        footer={<><Button variant="outline" onClick={() => { setShowForm(false); setEditing(null); setError(""); }}>Batal</Button><Button onClick={save} disabled={busy}>{busy ? "Memproses..." : "Simpan"}</Button></>}
      >
        <div className="space-y-4">
          {error && (
            <div className="flex items-center gap-2 text-xs text-rose-600 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">
              <AlertCircle size={14} /> {error}
            </div>
          )}
          <Field label="Judul"><Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></Field>
          <Field label="Isi"><Textarea rows={4} value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} /></Field>
          <Field label="Target Pembaca">
            <Select value={form.audience} onChange={(e) => setForm({ ...form, audience: e.target.value })}>
              <option value="all">Semua pengguna</option>
              <option value="mitra">Mitra</option>
              <option value="submitra">Sub Mitra</option>
              <option value="loket">Loket</option>
            </Select>
          </Field>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={form.pinned} onChange={(e) => setForm({ ...form, pinned: e.target.checked })} />
            <span className="text-sm text-slate-700">Sematkan di atas</span>
          </label>
        </div>
      </Modal>
    </PageContainer>
  );
}
