import { useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import { useProducts, roleToUi, type ProductRow } from "@/lib/hooks";
import { PageContainer } from "@/components/PageContainer";
import { PageHeader } from "@/components/ui/Common";
import { Card, CardHeader } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Field, Input } from "@/components/ui/Form";
import { formatRupiah } from "@/lib/format";
import { CATEGORY_LABELS, CATEGORY_COLORS, type ProductCategory } from "@/lib/types";
import { ROLE_LABELS } from "@/lib/nav";
import { Tags, Pencil, Info, AlertCircle } from "lucide-react";

export function PricingPage() {
  const { profile, isSuperAdmin } = useAuth();
  const { products, loading, refresh } = useProducts();
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<ProductRow | null>(null);
  const [priceInput, setPriceInput] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  if (!profile) return null;
  const role = roleToUi(profile.role);
  const canEdit = role === "mitra" || role === "submitra";

  const editableProducts = products.filter((p) => p.editable_by_mitra && p.status === "active");

  const visibleProducts = useMemo(() => {
    return editableProducts.filter((p) =>
      search ? p.name.toLowerCase().includes(search.toLowerCase()) || p.provider.toLowerCase().includes(search.toLowerCase()) : true
    );
  }, [editableProducts, search]);

  const openEdit = (product: ProductRow) => {
    setPriceInput(String(product.default_sell_price));
    setEditing(product);
    setError("");
  };

  const savePrice = async () => {
    if (!editing) return;
    const price = Number(priceInput) || 0;
    if (price < editing.base_price) { setError("Harga jual tidak boleh di bawah harga dasar"); return; }

    setBusy(true);
    setError("");
    const { error: rpcErr } = await supabase.rpc("admin_set_pricing_rule", {
      p_product_id: editing.id,
      p_target_uid: profile.id,
      p_sell_price: price,
      p_min_price: editing.base_price,
      p_max_price: null,
    });
    setBusy(false);
    if (rpcErr) { setError(rpcErr.message); return; }
    setEditing(null);
    refresh();
  };

  return (
    <PageContainer>
      <PageHeader
        title="Pengaturan Harga"
        description={
          isSuperAdmin
            ? "Pantau harga jual produk di seluruh jaringan."
            : "Atur harga jual produk pulsa & paket data untuk jaringan Anda."
        }
      />

      <Card className="mb-5">
        <div className="flex items-start gap-3 p-4">
          <div className="w-9 h-9 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center shrink-0">
            <Info size={18} />
          </div>
          <div className="text-sm text-slate-600 space-y-1">
            <p><b>Produk Pulsa &amp; Paket Data:</b> Mitra dan Sub Mitra dapat menentukan harga jual sendiri, asalkan tidak di bawah harga dasar.</p>
            <p><b>Produk PLN &amp; PDAM:</b> Harga jual ditetapkan oleh Super Admin dan tidak bisa diubah oleh Mitra/Sub Mitra.</p>
            <p className="text-xs text-slate-400">Harga yang Anda atur akan berlaku untuk Anda dan jaringan di bawah Anda yang belum mengatur sendiri.</p>
          </div>
        </div>
      </Card>

      <Card className="mb-4 p-4">
        <div className="relative w-full sm:w-80">
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Cari produk..." />
        </div>
      </Card>

      <Card className="mb-6">
        <CardHeader
          title={isSuperAdmin ? "Daftar Harga Produk" : `Harga Jual Anda (${ROLE_LABELS[role]})`}
          subtitle="Produk yang dapat diatur harganya oleh Mitra/Sub Mitra."
        />
        <div className="w-full max-w-full">
          <table className="w-full table-fixed text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-slate-500 bg-slate-50 border-y border-slate-100">
                <th className="px-2.5 py-2 break-words font-semibold">Produk</th>
                <th className="px-2.5 py-2 break-words font-semibold">Harga Dasar</th>
                <th className="px-2.5 py-2 break-words font-semibold">Harga Default</th>
                {!isSuperAdmin && <th className="px-2.5 py-2 break-words font-semibold">Harga Anda</th>}
                <th className="px-2.5 py-2 break-words font-semibold">Profit</th>
                {canEdit && <th className="px-2.5 py-2 break-words font-semibold">Aksi</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading && <tr><td colSpan={6} className="px-5 py-8 text-center text-sm text-slate-500">Memuat data...</td></tr>}
              {!loading && visibleProducts.length === 0 && (
                <tr><td colSpan={6} className="px-5 py-8 text-center text-sm text-slate-500">Belum ada produk yang dapat diatur harganya.</td></tr>
              )}
              {visibleProducts.map((p) => {
                const myPrice = p.default_sell_price;
                const profit = myPrice - p.base_price;
                return (
                  <tr key={p.id} className="hover:bg-slate-50/60">
                    <td className="px-2.5 py-2 break-words">
                      <div className="flex items-center gap-2">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${CATEGORY_COLORS[p.category_slug as ProductCategory] || "bg-slate-100 text-slate-600"}`}>{CATEGORY_LABELS[p.category_slug as ProductCategory] || p.category_name}</span>
                        <div>
                          <div className="text-sm font-medium text-slate-800">{p.name}</div>
                          <div className="text-xs text-slate-400">{p.provider}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-2.5 py-2 break-words text-slate-700">{formatRupiah(p.base_price)}</td>
                    <td className="px-2.5 py-2 break-words text-slate-700">{formatRupiah(p.default_sell_price)}</td>
                    {!isSuperAdmin && (
                      <td className="px-2.5 py-2 break-words">
                        <span className="text-sm font-semibold text-slate-800">{formatRupiah(myPrice)}</span>
                      </td>
                    )}
                    <td className="px-2.5 py-2 break-words text-emerald-600 font-medium">+{formatRupiah(profit)}</td>
                    {canEdit && (
                      <td className="px-2.5 py-2 break-words">
                        <Button variant="outline" size="sm" onClick={() => openEdit(p)}>
                          <Pencil size={13} /> Atur
                        </Button>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      <Modal
        open={!!editing}
        onClose={() => { setEditing(null); setError(""); }}
        title="Atur Harga Jual"
        subtitle={editing?.name}
        footer={
          <>
            <Button variant="outline" onClick={() => { setEditing(null); setError(""); }}>Batal</Button>
            <Button onClick={savePrice} disabled={busy}>{busy ? "Memproses..." : "Simpan"}</Button>
          </>
        }
      >
        {editing && (
          <div className="space-y-4">
            {error && (
              <div className="flex items-center gap-2 text-xs text-rose-600 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">
                <AlertCircle size={14} /> {error}
              </div>
            )}
            <div className="rounded-xl border border-slate-200 divide-y divide-slate-100 text-sm">
              <div className="flex justify-between px-4 py-2.5"><span className="text-slate-500">Harga Dasar</span><span className="font-medium text-slate-800">{formatRupiah(editing.base_price)}</span></div>
              <div className="flex justify-between px-4 py-2.5"><span className="text-slate-500">Harga Default</span><span className="font-medium text-slate-800">{formatRupiah(editing.default_sell_price)}</span></div>
            </div>
            <Field label="Harga Jual Baru (Rp)" hint={`Tidak boleh di bawah harga dasar (${formatRupiah(editing.base_price)}).`}>
              <Input type="number" value={priceInput} onChange={(e) => setPriceInput(e.target.value)} />
            </Field>
            {Number(priceInput) < editing.base_price && (
              <div className="text-xs text-rose-600 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">
                Harga jual tidak boleh di bawah harga dasar.
              </div>
            )}
            <div className="flex items-center justify-between px-4 py-2.5 rounded-lg bg-slate-50 text-sm">
              <span className="text-slate-500">Estimasi profit per transaksi</span>
              <span className="font-semibold text-emerald-600">+{formatRupiah((Number(priceInput) || 0) - editing.base_price)}</span>
            </div>
          </div>
        )}
      </Modal>
    </PageContainer>
  );
}
