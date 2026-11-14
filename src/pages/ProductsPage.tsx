import { useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth, dbRoleToAppRole } from "@/lib/auth";
import { useProducts, useProductCategories, type ProductRow } from "@/lib/hooks";
import { PageContainer } from "@/components/PageContainer";
import { PageHeader, SearchInput } from "@/components/ui/Common";
import { Card, CardHeader } from "@/components/ui/Card";
import { Table, type Column } from "@/components/ui/Table";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Field, Input, Select, Textarea } from "@/components/ui/Form";
import { formatRupiah } from "@/lib/format";
import { CATEGORY_LABELS, CATEGORY_COLORS, type ProductCategory } from "@/lib/types";
import { Plus, Power, Package, AlertCircle } from "lucide-react";

const statusTone: Record<string, "success" | "danger"> = {
  active: "success",
  inactive: "danger",
};

export function ProductsPage() {
  const { profile, isSuperAdmin } = useAuth();
  const { products, loading, refresh } = useProducts();
  const categories = useProductCategories();
  const [search, setSearch] = useState("");
  const [catFilter, setCatFilter] = useState<"semua" | string>("semua");
  const [editing, setEditing] = useState<ProductRow | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    name: "",
    provider: "",
    categorySlug: "pulsa",
    basePrice: "",
    defaultSellPrice: "",
    editableByMitra: true,
    description: "",
  });

  if (!profile) return null;
  const role = dbRoleToAppRole(profile.role);
  const canManage = isSuperAdmin;

  const filtered = useMemo(() => {
    return products.filter((p) => {
      if (catFilter !== "semua" && p.category_slug !== catFilter) return false;
      if (search) {
        const q = search.toLowerCase();
        return p.name.toLowerCase().includes(q) || p.provider.toLowerCase().includes(q);
      }
      return true;
    });
  }, [products, catFilter, search]);

  const openAdd = () => {
    setForm({ name: "", provider: "", categorySlug: categories[0]?.slug ?? "pulsa", basePrice: "", defaultSellPrice: "", editableByMitra: true, description: "" });
    setShowAdd(true);
    setError("");
  };

  const openEdit = (p: ProductRow) => {
    setForm({
      name: p.name,
      provider: p.provider,
      categorySlug: p.category_slug,
      basePrice: String(p.base_price),
      defaultSellPrice: String(p.default_sell_price),
      editableByMitra: p.editable_by_mitra,
      description: p.description ?? "",
    });
    setEditing(p);
    setError("");
  };

  const save = async () => {
    const basePrice = Number(form.basePrice) || 0;
    const sellPrice = Number(form.defaultSellPrice) || 0;
    if (!form.name || !form.provider) { setError("Nama dan provider wajib diisi"); return; }
    if (sellPrice < basePrice) { setError("Harga jual tidak boleh di bawah harga dasar"); return; }

    setBusy(true);
    setError("");
    const { error: rpcErr } = await supabase.rpc("admin_manage_product", {
      p_action: editing ? "update" : "create",
      p_product_id: editing?.id ?? null,
      p_name: form.name,
      p_provider: form.provider,
      p_category_slug: form.categorySlug,
      p_base_price: basePrice,
      p_default_sell_price: sellPrice,
      p_editable_by_mitra: form.editableByMitra,
      p_description: form.description || null,
    });
    setBusy(false);
    if (rpcErr) { setError(rpcErr.message); return; }
    setEditing(null);
    setShowAdd(false);
    refresh();
  };

  const toggleStatus = async (p: ProductRow) => {
    const { error: rpcErr } = await supabase.rpc("admin_manage_product", {
      p_action: "toggle_status",
      p_product_id: p.id,
    });
    if (rpcErr) { alert(rpcErr.message); return; }
    refresh();
  };

  const columns: Column<ProductRow>[] = [
    {
      key: "name",
      header: "Produk",
      render: (p) => (
        <div className="flex items-center gap-3">
          <div className={`w-9 h-9 rounded-lg flex items-center justify-center text-xs font-bold ${CATEGORY_COLORS[p.category_slug as ProductCategory] || "bg-slate-100 text-slate-600"}`}>
            <Package size={16} />
          </div>
          <div>
            <div className="text-sm font-medium text-slate-800">{p.name}</div>
            <div className="text-xs text-slate-500">{p.provider}</div>
          </div>
        </div>
      ),
    },
    {
      key: "category",
      header: "Kategori",
      render: (p) => <Badge tone="info">{CATEGORY_LABELS[p.category_slug as ProductCategory] || p.category_name}</Badge>,
    },
    {
      key: "basePrice",
      header: "Harga Dasar",
      render: (p) => <span className="text-sm text-slate-700">{formatRupiah(p.base_price)}</span>,
    },
    {
      key: "sellPrice",
      header: "Harga Jual Default",
      render: (p) => <span className="text-sm font-semibold text-slate-800">{formatRupiah(p.default_sell_price)}</span>,
    },
    {
      key: "profit",
      header: "Estimasi Profit",
      render: (p) => <span className="text-sm text-emerald-600">+{formatRupiah(p.default_sell_price - p.base_price)}</span>,
    },
    {
      key: "editable",
      header: "Harga Mitra",
      render: (p) => p.editable_by_mitra
        ? <Badge tone="blue">Bisa diatur Mitra</Badge>
        : <Badge tone="neutral">Dikuasai Super Admin</Badge>,
    },
    {
      key: "status",
      header: "Status",
      render: (p) => <Badge tone={statusTone[p.status]}>{p.status === "active" ? "Aktif" : "Nonaktif"}</Badge>,
    },
    ...(canManage ? [{
      key: "actions",
      header: "Aksi",
      render: (p: ProductRow) => (
        <div className="flex items-center gap-1">
          <button onClick={() => openEdit(p)} className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 hover:text-blue-600"><Plus size={15} /></button>
          <button onClick={() => toggleStatus(p)} className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 hover:text-rose-600"><Power size={15} /></button>
        </div>
      ),
    }] : []),
  ];

  return (
    <PageContainer>
      <PageHeader
        title="Produk PPOB"
        description={canManage ? "Kelola seluruh katalog produk PPOB." : "Lihat katalog produk yang tersedia."}
      >
        {canManage && <Button onClick={openAdd}><Plus size={16} /> Tambah Produk</Button>}
      </PageHeader>

      <Card className="mb-4 p-4">
        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
          <SearchInput value={search} onChange={setSearch} placeholder="Cari produk / provider..." />
          <Select value={catFilter} onChange={(e) => setCatFilter(e.target.value)} className="w-auto">
            <option value="semua">Semua kategori</option>
            {categories.map((c) => (
              <option key={c.id} value={c.slug}>{c.name}</option>
            ))}
          </Select>
        </div>
      </Card>

      <Card>
        <CardHeader title="Katalog Produk" subtitle={loading ? "Memuat..." : `${filtered.length} produk`} />
        <Table columns={columns} data={filtered} rowKey={(p) => p.id} empty={loading ? "Memuat data..." : "Belum ada produk."} />
      </Card>

      <Modal
        open={showAdd || !!editing}
        onClose={() => { setShowAdd(false); setEditing(null); setError(""); }}
        title={editing ? "Edit Produk" : "Tambah Produk"}
        subtitle="Hanya Super Admin yang dapat mengelola katalog."
        footer={
          <>
            <Button variant="outline" onClick={() => { setShowAdd(false); setEditing(null); setError(""); }}>Batal</Button>
            <Button onClick={save} disabled={busy}>{busy ? "Memproses..." : "Simpan"}</Button>
          </>
        }
      >
        <div className="space-y-4">
          {error && (
            <div className="flex items-center gap-2 text-xs text-rose-600 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">
              <AlertCircle size={14} /> {error}
            </div>
          )}
          <Field label="Nama Produk"><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="cth: Pulsa 50.000" /></Field>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Provider"><Input value={form.provider} onChange={(e) => setForm({ ...form, provider: e.target.value })} placeholder="cth: Telkomsel" /></Field>
            <Field label="Kategori">
              <Select value={form.categorySlug} onChange={(e) => setForm({ ...form, categorySlug: e.target.value })}>
                {categories.map((c) => (
                  <option key={c.id} value={c.slug}>{c.name}</option>
                ))}
              </Select>
            </Field>
            <Field label="Harga Dasar (Rp)"><Input type="number" value={form.basePrice} onChange={(e) => setForm({ ...form, basePrice: e.target.value })} /></Field>
            <Field label="Harga Jual Default (Rp)" hint="Harga acuan untuk produk ini."><Input type="number" value={form.defaultSellPrice} onChange={(e) => setForm({ ...form, defaultSellPrice: e.target.value })} /></Field>
          </div>
          <Field label="Deskripsi (opsional)"><Textarea rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
          <label className="flex items-start gap-2 cursor-pointer">
            <input type="checkbox" checked={form.editableByMitra} onChange={(e) => setForm({ ...form, editableByMitra: e.target.checked })} className="mt-0.5" />
            <span className="text-sm text-slate-700">
              Izinkan Mitra/Sub Mitra mengatur harga jual sendiri untuk produk ini.
              <br />
              <span className="text-xs text-slate-400">
                Centang untuk produk pulsa &amp; paket data. Jangan centang untuk PLN &amp; PDAM (harga tetap).
              </span>
            </span>
          </label>
        </div>
      </Modal>
    </PageContainer>
  );
}
