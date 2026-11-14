import { useMemo, useState } from "react";
import { useAuth } from "@/lib/auth";
import { useProducts, useMyWallet, useTransactions, type ProductRow, type TransactionRow } from "@/lib/hooks";
import { PageContainer } from "@/components/PageContainer";
import { PageHeader } from "@/components/ui/Common";
import { Card, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Field, Input } from "@/components/ui/Form";
import { Modal } from "@/components/ui/Modal";
import { formatRupiah, formatWaktu } from "@/lib/format";
import { CATEGORY_LABELS, CATEGORY_COLORS, type ProductCategory } from "@/lib/types";
import {
  Smartphone, Wifi, Zap, Droplets, CreditCard, ShoppingCart,
  CheckCircle2, XCircle, Clock, Search, Receipt, AlertCircle,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

const categoryIcons: Record<string, LucideIcon> = {
  pulsa: Smartphone,
  paket_data: Wifi,
  token_listrik: Zap,
  tagihan_pln: Zap,
  tagihan_pdam: Droplets,
  emoney: CreditCard,
};

const statusMeta: Record<string, { tone: any; label: string; icon: LucideIcon }> = {
  success: { tone: "success", label: "Berhasil", icon: CheckCircle2 },
  pending: { tone: "warning", label: "Pending", icon: Clock },
  failed: { tone: "danger", label: "Gagal", icon: XCircle },
  refunded: { tone: "info", label: "Refund", icon: CheckCircle2 },
};

export function BuyPage() {
  const { profile } = useAuth();
  const { products, loading } = useProducts();
  const { wallet } = useMyWallet();
  const { transactions, refresh: refreshTx } = useTransactions();
  const [activeCat, setActiveCat] = useState<string>("pulsa");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<ProductRow | null>(null);
  const [customerNumber, setCustomerNumber] = useState("");
  const [error, setError] = useState("");

  if (!profile) return null;
  const balance = wallet ? Number(wallet.balance) : 0;

  const categories = useMemo(() => {
    const slugs = products.map((p) => p.category_slug).filter((v, i, a) => a.indexOf(v) === i);
    return slugs.length > 0 ? slugs : Object.keys(CATEGORY_LABELS);
  }, [products]);

  const visibleProducts = products.filter(
    (p) => p.status === "active" && p.category_slug === activeCat &&
      (search ? p.name.toLowerCase().includes(search.toLowerCase()) : true)
  );

  const openProduct = (p: ProductRow) => {
    setSelected(p);
    setCustomerNumber("");
    setError("");
  };

  const myTx = transactions.filter((t) => t.user_id === profile.id).slice(0, 5);

  return (
    <PageContainer>
      <PageHeader title="Beli Produk" description="Pilih produk PPOB yang tersedia." />

      <Card className="mb-6 overflow-hidden">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-5 bg-gradient-to-r from-slate-900 to-slate-800 text-white">
          <div>
            <div className="text-xs text-slate-300 uppercase tracking-wide">Saldo Anda</div>
            <div className="text-3xl font-bold mt-1">{formatRupiah(balance)}</div>
          </div>
        </div>
      </Card>

      <Card className="mb-5">
        <div className="flex items-start gap-3 p-4">
          <div className="w-9 h-9 rounded-lg bg-amber-50 text-amber-600 flex items-center justify-center shrink-0">
            <AlertCircle size={18} />
          </div>
          <div className="text-sm text-slate-600">
            <p className="font-medium text-slate-700">Integrasi provider PPOB belum aktif</p>
            <p className="text-xs mt-1">Transaksi pembelian akan tersedia setelah kredensial provider dikonfigurasi. Hubungi Super Admin untuk informasi lebih lanjut.</p>
          </div>
        </div>
      </Card>

      <div className="flex gap-2 overflow-x-auto pb-2 mb-4">
        {categories.map((c) => {
          const Icon = categoryIcons[c] || ShoppingCart;
          const active = c === activeCat;
          return (
            <button
              key={c}
              onClick={() => { setActiveCat(c); setSearch(""); }}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium whitespace-nowrap border transition ${
                active ? "bg-blue-600 text-white border-blue-600 shadow-sm" : "bg-white text-slate-600 border-slate-200 hover:border-blue-300"
              }`}
            >
              <Icon size={16} />
              {CATEGORY_LABELS[c as ProductCategory] || c}
            </button>
          );
        })}
      </div>

      <div className="relative w-full sm:w-80 mb-4">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={`Cari ${CATEGORY_LABELS[activeCat as ProductCategory]?.toLowerCase() || activeCat}...`}
          className="pl-9"
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 mb-8">
        {loading && <div className="col-span-full p-10 text-center text-sm text-slate-500">Memuat produk...</div>}
        {!loading && visibleProducts.length === 0 && (
          <div className="col-span-full p-10 text-center text-sm text-slate-500 bg-white rounded-xl border border-slate-200">
            Tidak ada produk ditemukan.
          </div>
        )}
        {visibleProducts.map((p) => (
          <button
            key={p.id}
            onClick={() => openProduct(p)}
            className="text-left p-4 rounded-2xl bg-white border border-slate-200 hover:border-blue-400 hover:shadow-lg transition group"
          >
            <div className="flex items-center justify-between mb-3">
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${CATEGORY_COLORS[p.category_slug as ProductCategory] || "bg-slate-100 text-slate-600"}`}>
                {(() => { const Icon = categoryIcons[p.category_slug] || ShoppingCart; return <Icon size={18} />; })()}
              </div>
              <span className="text-xs text-slate-400">{p.provider}</span>
            </div>
            <div className="text-sm font-semibold text-slate-800 group-hover:text-blue-700">{p.name}</div>
            <div className="mt-2 flex items-baseline justify-between">
              <div>
                <div className="text-lg font-bold text-slate-900">{formatRupiah(p.default_sell_price)}</div>
              </div>
              <ShoppingCart size={16} className="text-slate-300 group-hover:text-blue-500" />
            </div>
          </button>
        ))}
      </div>

      <Card>
        <CardHeader title="Transaksi Terbaru Anda" subtitle="5 transaksi terakhir" />
        <div className="divide-y divide-slate-100">
          {myTx.length === 0 && <div className="p-8 text-center text-sm text-slate-500">Belum ada transaksi.</div>}
          {myTx.map((t: TransactionRow) => {
            const m = statusMeta[t.status] || statusMeta.pending;
            const Icon = m.icon;
            return (
              <div key={t.id} className="flex items-center gap-3 px-5 py-3">
                <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${CATEGORY_COLORS[t.category_slug_snapshot as ProductCategory] || "bg-slate-100 text-slate-600"}`}>
                  <Receipt size={16} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-slate-800 truncate">{t.product_name_snapshot}</div>
                  <div className="text-xs text-slate-500">{t.invoice_code} • {formatWaktu(t.created_at)}</div>
                </div>
                <div className="text-right">
                  <div className="text-sm font-semibold text-slate-800">{formatRupiah(Number(t.amount))}</div>
                </div>
                <Badge tone={m.tone}><Icon size={12} /> {m.label}</Badge>
              </div>
            );
          })}
        </div>
      </Card>

      <Modal
        open={!!selected}
        onClose={() => setSelected(null)}
        title={selected?.name ?? ""}
        subtitle={selected ? `${CATEGORY_LABELS[selected.category_slug as ProductCategory] || selected.category_name} • ${selected.provider}` : ""}
        footer={
          <>
            <Button variant="outline" onClick={() => setSelected(null)}>Tutup</Button>
          </>
        }
      >
        {selected && (
          <div className="space-y-4">
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-50 border border-amber-200 text-amber-800 text-xs">
              Transaksi pembelian belum tersedia. Integrasi provider PPOB sedang dalam pengembangan.
            </div>
            <Field label="Nomor Pelanggan / Nomor Tujuan" hint="Nomor HP, ID pelanggan, atau meteran listrik.">
              <Input
                value={customerNumber}
                onChange={(e) => setCustomerNumber(e.target.value)}
                placeholder="cth: 0812-xxxx-xxxx atau 12345678901"
                autoFocus
                disabled
              />
            </Field>
            <div className="rounded-xl border border-slate-200 divide-y divide-slate-100">
              <Row label="Harga Dasar" value={formatRupiah(selected.base_price)} />
              <Row label="Harga Jual" value={formatRupiah(selected.default_sell_price)} strong />
              <Row label="Saldo Anda" value={formatRupiah(balance)} />
            </div>
          </div>
        )}
      </Modal>
    </PageContainer>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between px-4 py-2.5 text-sm">
      <span className="text-slate-500">{label}</span>
      <span className={`${strong ? "font-semibold" : "font-medium"} text-slate-800`}>{value}</span>
    </div>
  );
}
