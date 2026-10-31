import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "./lib/supabase";

type Product = {
  id: string;
  sku: string;
  name: string;
  category: string | null;
  selling_price: number;
  cost_price: number;
  stock_qty: number;
  reorder_level: number;
  active: boolean;
};
type CartItem = Product & { qty: number };
type UserProfile = { user_id: string; email: string | null; display_name: string | null; role: "owner" | "manager" | "cashier" };
type Sale = {
  id: string;
  invoice_number: string;
  subtotal: number;
  tax_amount: number;
  discount_amount: number;
  total_amount: number;
  payment_method: string;
  created_at: string;
  sale_items?: Array<{ product_name: string; sku: string; quantity: number; unit_price: number; line_total: number }>;
};
type Receipt = { invoice_number: string; subtotal: number; tax_amount: number; discount_amount: number; total_amount: number; payment_method: string; items: CartItem[]; created_at: string };

const money = (n: number) => "₹" + Number(n || 0).toFixed(2);
const todayStart = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.toISOString(); };

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [staff, setStaff] = useState<UserProfile[]>([]);
  const [authLoading, setAuthLoading] = useState(true);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authMessage, setAuthMessage] = useState("");
  const [page, setPage] = useState("Dashboard");
  const [products, setProducts] = useState<Product[]>([]);
  const [sales, setSales] = useState<Sale[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [search, setSearch] = useState("");
  const [cart, setCart] = useState<CartItem[]>([]);
  const [paymentMethod, setPaymentMethod] = useState("cash");
  const [discount, setDiscount] = useState("0");
  const [gstEnabled, setGstEnabled] = useState(() => localStorage.getItem("mrs_gst_enabled") === "true");
  const [gstRate, setGstRate] = useState(() => localStorage.getItem("mrs_gst_rate") || "5");
  const [storeName, setStoreName] = useState(() => localStorage.getItem("mrs_store_name") || "MRS Stationery");
  const [productForm, setProductForm] = useState({ id: "", name: "", sku: "", category: "", selling_price: "", cost_price: "", stock_qty: "", reorder_level: "5" });
  const [showProductForm, setShowProductForm] = useState(false);
  const [receipt, setReceipt] = useState<Receipt | null>(null);

  useEffect(() => {
    if (!supabase) { setAuthLoading(false); return; }
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); setAuthLoading(false); });
    const { data } = supabase.auth.onAuthStateChange((_event, next) => setSession(next));
    return () => data.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (session) { void refreshData(); void loadProfile(); }
    else { setProducts([]); setSales([]); setProfile(null); setStaff([]); }
  }, [session]);

  async function loadProfile() {
    if (!supabase || !session) return;
    const { data, error } = await supabase.from("profiles").select("user_id,email,display_name,role").eq("user_id", session.user.id).single();
    if (error) { setMessage("Unable to load your staff role: " + error.message); setProfile(null); return; }
    setProfile(data as UserProfile);
  }

  async function loadStaff() {
    if (!supabase || profile?.role !== "owner") return;
    const { data, error } = await supabase.from("profiles").select("user_id,email,display_name,role").order("created_at");
    if (error) setMessage("Unable to load staff: " + error.message);
    else setStaff((data || []) as UserProfile[]);
  }

  async function updateStaffRole(userId: string, role: UserProfile["role"]) {
    if (!supabase || profile?.role !== "owner") return;
    const { error } = await supabase.from("profiles").update({ role, updated_at: new Date().toISOString() }).eq("user_id", userId);
    if (error) setMessage("Role update failed: " + error.message);
    else { setMessage("Staff role updated."); await loadStaff(); }
  }

  async function refreshData() {
    if (!supabase) return;
    setLoading(true);
    setMessage("");
    const [p, s] = await Promise.all([
      supabase.from("products").select("*").eq("active", true).order("name"),
      supabase.from("sales").select("*, sale_items(*)").order("created_at", { ascending: false }).limit(100)
    ]);
    if (p.error) setMessage("Products: " + p.error.message);
    else setProducts((p.data || []) as Product[]);
    if (s.error) setMessage("Sales: " + s.error.message);
    else setSales((s.data || []) as Sale[]);
    setLoading(false);
  }

  async function handleAuth(e: FormEvent) {
    e.preventDefault();
    if (!supabase) return;
    setAuthLoading(true); setAuthMessage("");
    const result = await supabase.auth.signInWithPassword({ email, password });
    setAuthLoading(false);
    if (result.error) setAuthMessage(result.error.message);
    else setAuthMessage("Signed in successfully.");
  }

  useEffect(() => { if (profile?.role === "owner") void loadStaff(); }, [profile]);

  const subtotal = useMemo(() => cart.reduce((sum, item) => sum + Number(item.selling_price) * item.qty, 0), [cart]);
  const discountAmount = Math.max(0, Math.min(subtotal, Number(discount) || 0));
  const taxAmount = gstEnabled ? Math.max(0, (subtotal - discountAmount) * (Number(gstRate) || 0) / 100) : 0;
  const total = Math.max(0, subtotal - discountAmount + taxAmount);
  const todaySales = sales.filter(s => s.created_at >= todayStart()).reduce((sum, s) => sum + Number(s.total_amount), 0);
  const lowStock = products.filter(p => p.stock_qty <= p.reorder_level);

  function addToCart(product: Product) {
    setCart(old => {
      const existing = old.find(item => item.id === product.id);
      if (existing) return old.map(item => item.id === product.id ? { ...item, qty: Math.min(item.qty + 1, product.stock_qty) } : item);
      return [...old, { ...product, qty: 1 }];
    });
  }

  async function completeSale() {
    if (!supabase || !cart.length) return;
    setLoading(true); setMessage("");
    const items = cart.map(item => ({ product_id: item.id, quantity: item.qty }));
    const { data, error } = await supabase.rpc("complete_sale", {
      p_items: items,
      p_payment_method: paymentMethod,
      p_discount_amount: discountAmount,
      p_tax_amount: taxAmount
    });
    setLoading(false);
    if (error) { setMessage("Sale could not be completed: " + error.message); return; }
    const result = data as { invoice_number: string };
    setReceipt({ invoice_number: result.invoice_number, subtotal, tax_amount: taxAmount, discount_amount: discountAmount, total_amount: total, payment_method: paymentMethod, items: [...cart], created_at: new Date().toISOString() });
    setCart([]); setDiscount("0"); setMessage("Sale saved and stock updated successfully.");
    await refreshData();
  }

  function openNewProduct(product?: Product) {
    setProductForm(product ? {
      id: product.id, name: product.name, sku: product.sku, category: product.category || "",
      selling_price: String(product.selling_price), cost_price: String(product.cost_price),
      stock_qty: String(product.stock_qty), reorder_level: String(product.reorder_level)
    } : { id: "", name: "", sku: "", category: "", selling_price: "", cost_price: "", stock_qty: "", reorder_level: "5" });
    setShowProductForm(true);
  }

  async function saveProduct(e: FormEvent) {
    e.preventDefault();
    if (!supabase) return;
    const payload = {
      name: productForm.name.trim(), sku: productForm.sku.trim(), category: productForm.category.trim(),
      selling_price: Number(productForm.selling_price), cost_price: Number(productForm.cost_price),
      stock_qty: Number(productForm.stock_qty), reorder_level: Number(productForm.reorder_level)
    };
    if (!payload.name || !payload.sku || !Number.isFinite(payload.selling_price) || payload.selling_price < 0 || !Number.isInteger(payload.stock_qty) || payload.stock_qty < 0) {
      setMessage("Enter a product name, unique SKU, valid price and whole-number stock quantity."); return;
    }
    setLoading(true); setMessage("");
    const result = productForm.id
      ? await supabase.from("products").update(payload).eq("id", productForm.id)
      : await supabase.from("products").insert(payload);
    setLoading(false);
    if (result.error) { setMessage(result.error.message); return; }
    setShowProductForm(false); setMessage("Product saved."); await refreshData();
  }

  async function archiveProduct(product: Product) {
    if (!supabase || !window.confirm("Deactivate " + product.name + "? It will no longer appear in billing.")) return;
    const { error } = await supabase.from("products").update({ active: false }).eq("id", product.id);
    if (error) setMessage(error.message); else { setMessage("Product deactivated."); await refreshData(); }
  }

  function saveSettings() {
    localStorage.setItem("mrs_store_name", storeName);
    localStorage.setItem("mrs_gst_enabled", String(gstEnabled));
    localStorage.setItem("mrs_gst_rate", gstRate);
    setMessage("Store preferences saved in this browser.");
  }

  if (!supabase) return <div className="authscreen"><div className="authbox"><div className="brandmark">M</div><h1>Connect Supabase</h1><p>Netlify environment variables are missing. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY, then redeploy.</p></div></div>;
  if (authLoading) return <div className="authscreen"><div className="authbox">Loading MRS Stationery…</div></div>;
  if (!session) return <div className="authscreen"><form className="authbox" onSubmit={handleAuth}><div className="brandmark">M</div><span className="eyebrow">MRS STATIONERY POS</span><h1>Welcome back</h1><p>Sign in to manage your store, products and billing. User accounts are created by the store owner.</p><label>Email address<input required type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" /></label><label>Password<input required minLength={6} type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Your password" /></label><button className="primary full" disabled={authLoading}>Sign in</button>{authMessage && <p className="notice">{authMessage}</p>}</form></div>;

  const nav = profile?.role === "cashier"
    ? ["Dashboard", "POS Billing", "Sales"]
    : profile?.role === "manager"
      ? ["Dashboard", "POS Billing", "Products", "Sales", "Inventory", "Settings"]
      : ["Dashboard", "POS Billing", "Products", "Sales", "Inventory", "Staff", "Settings"];
  if (session && !profile) return <div className="authscreen"><div className="authbox"><h1>Loading staff profile</h1><p>Your account profile is being checked. If this message remains, ask the owner to verify your staff profile in Supabase.</p></div></div>;
  const filteredProducts = products.filter(p => (p.name + p.sku + (p.category || "")).toLowerCase().includes(search.toLowerCase()));
  return <div className="shell">
    <aside className="sidebar">
      <div className="brand"><div className="brandmark">M</div><div><b>{storeName}</b><small>STORE MANAGEMENT</small></div></div>
      <div className="navlabel">WORKSPACE</div>
      {nav.map(n => <button key={n} className={page === n ? "nav active" : "nav"} onClick={() => { setPage(n); setReceipt(null); }}><span>{({ Dashboard: "▦", "POS Billing": "▣", Products: "▤", Sales: "↗", Inventory: "▥", Staff: "♙", Settings: "⚙" } as Record<string, string>)[n]}</span>{n}</button>)}
      <div className="sidebarfoot"><span className="live"></span> Connected · {session.user.email}</div>
      <button className="signout" onClick={async () => { if (!supabase) { setMessage("Supabase connection is not configured."); return; } await supabase.auth.signOut(); }}>Sign out</button>
    </aside>
    <main className="main">
      <header><div><span className="eyebrow">{storeName.toUpperCase()} / STORE</span><h1>{page}</h1></div><div className="user"><div className="avatar">M</div><div><b>{session.user.email}</b><small>{profile?.role ? profile.role.toUpperCase() : "Signed in"}</small></div></div></header>
      {message && <div className="notice">{message}<button onClick={() => setMessage("")}>×</button></div>}
      {loading && <div className="muted">Working…</div>}
      {page === "Dashboard" && <>
        <section className="welcome"><div><span className="eyebrow light">LIVE STORE OVERVIEW</span><h2>Good day! Ready for business?</h2><p>Your store activity, updated from Supabase.</p></div><button className="primary" onClick={() => setPage("POS Billing")}>＋ New sale</button></section>
        <div className="stats"><Stat label="TODAY'S SALES" value={money(todaySales)} note={sales.filter(s => s.created_at >= todayStart()).length + " bills today"} icon="₹"/><Stat label="TOTAL BILLS" value={String(sales.length)} note="Recent 100 transactions" icon="▣"/><Stat label="ACTIVE PRODUCTS" value={String(products.length)} note="Live catalogue" icon="▤"/><Stat label="LOW STOCK ITEMS" value={String(lowStock.length)} note="At or below reorder level" icon="!" alert/></div>
        <div className="panel"><div className="panelhead"><div><h3>Quick actions</h3><p>Common tasks for your store</p></div></div><div className="quick">{[["POS Billing","Create a customer bill","▣"],["Products","Manage your catalogue","▤"],["Inventory","Review stock levels","▥"],["Sales","View recent transactions","↗"]].filter(([n]) => profile?.role !== "cashier" || ["POS Billing", "Sales"].includes(n)).map(([n,d,i]) => <button key={n} className="quickcard" onClick={() => setPage(n)}><span>{i}</span><b>{n}</b><small>{d}</small></button>)}</div></div>
        <div className="panel"><div className="panelhead"><div><h3>Low stock watch</h3><p>Products at or below their reorder level</p></div><button className="textbtn" onClick={() => setPage("Inventory")}>View inventory →</button></div><ProductTable products={lowStock}/></div>
      </>}
      {page === "POS Billing" && <div className="posgrid">
        <section className="panel"><div className="panelhead"><div><h3>Product catalogue</h3><p>Select products to add them to the bill</p></div></div><input className="search" placeholder="Search product or SKU…" value={search} onChange={e => setSearch(e.target.value)}/><div className="catalog">{filteredProducts.map(p => <button key={p.id} className="productcard" onClick={() => addToCart(p)} disabled={p.stock_qty <= 0 || (cart.find(x => x.id === p.id)?.qty || 0) >= p.stock_qty}><span className="producticon">▤</span><b>{p.name}</b><small>{p.sku} · {p.stock_qty} in stock</small><strong>{money(p.selling_price)}</strong><em>＋ Add</em></button>)}</div>{!filteredProducts.length && <p className="muted">No matching products. Add products from the Products page.</p>}</section>
        <section className="panel bill"><div className="panelhead"><div><h3>Current bill</h3><p>{cart.length} product line(s)</p></div><button className="textbtn" onClick={() => setCart([])}>Clear</button></div>
          {!cart.length ? <div className="empty"><span>▣</span><b>Your bill is empty</b><small>Select products to begin billing</small></div> : <div className="cartitems">{cart.map(item => <div className="cartrow" key={item.id}><div><b>{item.name}</b><small>{money(item.selling_price)} × {item.qty}</small></div><div className="qty"><button onClick={() => setCart(c => c.map(x => x.id === item.id ? { ...x, qty: x.qty - 1 } : x).filter(x => x.qty > 0))}>−</button><b>{item.qty}</b><button disabled={item.qty >= item.stock_qty} onClick={() => addToCart(item)}>＋</button></div><strong>{money(item.selling_price * item.qty)}</strong></div>)}</div>}
          <label className="fieldlabel">Payment method<select value={paymentMethod} onChange={e => setPaymentMethod(e.target.value)}><option value="cash">Cash</option><option value="upi">UPI</option><option value="card">Card</option><option value="other">Other</option></select></label>
          <label className="fieldlabel">Discount (₹)<input type="number" min="0" max={subtotal} value={discount} onChange={e => setDiscount(e.target.value)}/></label>
          <div className="billtotal"><div><span>Subtotal</span><b>{money(subtotal)}</b></div><div><span>Discount</span><b>−{money(discountAmount)}</b></div><div><span>GST {gstEnabled ? "(" + gstRate + "%)" : "(disabled)"}</span><b>{money(taxAmount)}</b></div><div className="grand"><span>Total payable</span><b>{money(total)}</b></div><button className="primary full" disabled={!cart.length || loading} onClick={completeSale}>Complete sale · {money(total)}</button><small className="muted">Sale is saved to Supabase and stock is deducted automatically.</small></div>
        </section>
      </div>}
      {page === "Products" && profile && profile.role !== "cashier" && <div className="panel"><div className="panelhead"><div><h3>Product catalogue</h3><p>Products saved in your database</p></div><button className="primary" onClick={() => openNewProduct()}>＋ Add product</button></div><ProductTable products={products} onEdit={openNewProduct} onArchive={archiveProduct}/></div>}
      {page === "Inventory" && profile && profile.role !== "cashier" && <div className="panel"><div className="panelhead"><div><h3>Stock overview</h3><p>Current available quantities and reorder levels</p></div></div><ProductTable products={products} inventory/></div>}
      {page === "Sales" && <div className="panel"><div className="panelhead"><div><h3>Sales history</h3><p>Latest 100 bills</p></div><button className="textbtn" onClick={refreshData}>Refresh</button></div><div className="tablewrap"><table><thead><tr><th>INVOICE</th><th>DATE</th><th>PAYMENT</th><th>SUBTOTAL</th><th>GST</th><th>TOTAL</th></tr></thead><tbody>{sales.map(s => <tr key={s.id}><td><b>{s.invoice_number}</b></td><td>{new Date(s.created_at).toLocaleString("en-IN")}</td><td>{s.payment_method}</td><td>{money(s.subtotal)}</td><td>{money(s.tax_amount)}</td><td><b>{money(s.total_amount)}</b></td></tr>)}</tbody></table>{!sales.length && <p className="muted">No sales recorded yet.</p>}</div></div>}
      {page === "Staff" && profile?.role === "owner" && <div className="panel"><div className="panelhead"><div><h3>Staff accounts and roles</h3><p>Create/invite accounts in Supabase Authentication → Users, then assign their role here. New accounts default to cashier.</p></div><button className="textbtn" onClick={loadStaff}>Refresh</button></div><div className="tablewrap"><table><thead><tr><th>EMAIL</th><th>DISPLAY NAME</th><th>ROLE</th></tr></thead><tbody>{staff.map(member => <tr key={member.user_id}><td><b>{member.email || "—"}</b>{member.user_id === session.user.id ? " (you)" : ""}</td><td>{member.display_name || "—"}</td><td><select aria-label={"Role for " + member.email} value={member.role} disabled={member.user_id === session.user.id} onChange={e => updateStaffRole(member.user_id, e.target.value as UserProfile["role"])}><option value="owner">Owner</option><option value="manager">Manager</option><option value="cashier">Cashier</option></select></td></tr>)}</tbody></table>{!staff.length && <p className="muted">No staff profiles found yet.</p>}</div><p className="muted">For security, your own role cannot be changed from this screen. Use the Supabase SQL Editor for the initial owner promotion.</p></div>}
      {page === "Settings" && profile && profile.role !== "cashier" && <div className="panel settings"><h3>Store settings</h3><p className="muted">These preferences are saved in this browser.</p><label className="fieldlabel">Store name<input value={storeName} onChange={e => setStoreName(e.target.value)}/></label><label className="checkline"><input type="checkbox" checked={gstEnabled} onChange={e => setGstEnabled(e.target.checked)}/> Enable GST on bills</label><label className="fieldlabel">GST rate (%)<input type="number" min="0" max="100" value={gstRate} onChange={e => setGstRate(e.target.value)} disabled={!gstEnabled}/></label><button className="primary" onClick={saveSettings}>Save preferences</button><p className="muted">Confirm your applicable GST rate and whether your product prices are GST-inclusive or GST-exclusive before issuing real tax invoices.</p></div>}
      {receipt && <div className="modalback"><div className="receipt print-area"><div className="receipt-head"><h2>{storeName}</h2><p>SALES RECEIPT</p><b>{receipt.invoice_number}</b><small>{new Date(receipt.created_at).toLocaleString("en-IN")}</small></div><div className="receipt-lines">{receipt.items.map(item => <div key={item.id}><span>{item.name} × {item.qty}</span><b>{money(item.selling_price * item.qty)}</b></div>)}</div><div className="receipt-total"><div><span>Subtotal</span><b>{money(receipt.subtotal)}</b></div><div><span>Discount</span><b>{money(receipt.discount_amount)}</b></div><div><span>GST</span><b>{money(receipt.tax_amount)}</b></div><div className="grand"><span>Total</span><b>{money(receipt.total_amount)}</b></div><small>Payment: {receipt.payment_method.toUpperCase()}</small></div><div className="receipt-actions"><button className="primary" onClick={() => window.print()}>Print receipt</button><button className="textbtn" onClick={() => setReceipt(null)}>Close</button></div></div></div>}
      {showProductForm && <div className="modalback"><form className="productform" onSubmit={saveProduct}><div className="panelhead"><h3>{productForm.id ? "Edit product" : "Add product"}</h3><button type="button" className="textbtn" onClick={() => setShowProductForm(false)}>Close</button></div><label className="fieldlabel">Product name<input required value={productForm.name} onChange={e => setProductForm({ ...productForm, name: e.target.value })}/></label><label className="fieldlabel">SKU<input required value={productForm.sku} onChange={e => setProductForm({ ...productForm, sku: e.target.value })}/></label><label className="fieldlabel">Category<input value={productForm.category} onChange={e => setProductForm({ ...productForm, category: e.target.value })}/></label><div className="formrow"><label className="fieldlabel">Selling price (₹)<input required type="number" min="0" step="0.01" value={productForm.selling_price} onChange={e => setProductForm({ ...productForm, selling_price: e.target.value })}/></label><label className="fieldlabel">Cost price (₹)<input type="number" min="0" step="0.01" value={productForm.cost_price} onChange={e => setProductForm({ ...productForm, cost_price: e.target.value })}/></label></div><div className="formrow"><label className="fieldlabel">Opening stock<input required type="number" min="0" step="1" value={productForm.stock_qty} onChange={e => setProductForm({ ...productForm, stock_qty: e.target.value })}/></label><label className="fieldlabel">Reorder level<input type="number" min="0" step="1" value={productForm.reorder_level} onChange={e => setProductForm({ ...productForm, reorder_level: e.target.value })}/></label></div><button className="primary full" disabled={loading}>Save product</button></form></div>}
      <footer>{storeName} POS <span>·</span> Supabase connected</footer>
    </main>
  </div>;
}

function Stat({ label, value, note, icon, alert = false }: { label: string; value: string; note: string; icon: string; alert?: boolean }) {
  return <div className="stat"><div className={alert ? "staticon alert" : "staticon"}>{icon}</div><small>{label}</small><strong>{value}</strong><span>{note}</span></div>;
}

function ProductTable({ products, onEdit, onArchive, inventory = false }: { products: Product[]; onEdit?: (product: Product) => void; onArchive?: (product: Product) => void; inventory?: boolean }) {
  return <div className="tablewrap"><table><thead><tr><th>PRODUCT</th><th>SKU</th><th>CATEGORY</th><th>PRICE</th><th>STOCK</th><th>STATUS</th>{onEdit && <th>ACTIONS</th>}</tr></thead><tbody>{products.map(p => <tr key={p.id}><td><b>{p.name}</b></td><td>{p.sku}</td><td>{p.category || "—"}</td><td>{money(p.selling_price)}</td><td>{p.stock_qty}</td><td><span className={p.stock_qty <= p.reorder_level ? "pill low" : "pill"}>{p.stock_qty <= p.reorder_level ? "Low stock" : "In stock"}</span></td>{onEdit && <td><button className="textbtn" onClick={() => onEdit(p)}>Edit</button> <button className="textbtn danger" onClick={() => onArchive?.(p)}>Deactivate</button></td>}</tr>)}</tbody></table>{!products.length && <p className="muted">{inventory ? "No products in inventory yet." : "No products added yet. Use Add product to get started."}</p>}</div>;
}
