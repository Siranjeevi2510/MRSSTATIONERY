import { useEffect, useMemo, useState } from "react";
import { supabase } from "./lib/supabase";
import "./catalogue.css";

type PublicProduct = {
  product_id: string;
  sku: string;
  name: string;
  category: string | null;
  selling_price: number;
  in_stock: boolean;
  image_url: string | null;
};
type CartLine = PublicProduct & { quantity: number };

const money = (value: number) => "₹" + Number(value || 0).toFixed(2);
const storeName = "MRS Stationery";
const whatsappNumber = (import.meta.env.VITE_STORE_WHATSAPP as string | undefined || "").replace(/\D/g, "");

export default function PublicCatalogue() {
  const [products, setProducts] = useState<PublicProduct[]>([]);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("All categories");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [cartOpen, setCartOpen] = useState(false);

  useEffect(() => {
    let mounted = true;
    async function load() {
      if (!supabase) {
        setError("The catalogue connection is not configured yet.");
        setLoading(false);
        return;
      }
      const { data, error: queryError } = await supabase.rpc("public_catalogue_products");
      if (!mounted) return;
      if (queryError) setError("Catalogue is not ready yet. Please try again later.");
      else setProducts((data || []) as PublicProduct[]);
      setLoading(false);
    }
    void load();
    return () => { mounted = false; };
  }, []);

  const categories = useMemo(() => ["All categories", ...Array.from(new Set(products.map(p => p.category?.trim()).filter((v): v is string => Boolean(v)))).sort()], [products]);
  const visibleProducts = useMemo(() => products.filter(p => {
    const matchesSearch = (p.name + " " + p.sku + " " + (p.category || "")).toLowerCase().includes(search.toLowerCase());
    const matchesCategory = category === "All categories" || p.category === category;
    return matchesSearch && matchesCategory;
  }), [products, search, category]);
  const cartCount = cart.reduce((sum, item) => sum + item.quantity, 0);
  const cartTotal = cart.reduce((sum, item) => sum + Number(item.selling_price) * item.quantity, 0);

  function add(product: PublicProduct) {
    if (!product.in_stock) return;
    setCart(old => {
      const current = old.find(item => item.product_id === product.product_id);
      return current
        ? old.map(item => item.product_id === product.product_id ? { ...item, quantity: item.quantity + 1 } : item)
        : [...old, { ...product, quantity: 1 }];
    });
    setCartOpen(true);
  }

  function changeQuantity(productId: string, delta: number) {
    setCart(old => old.map(item => item.product_id === productId ? { ...item, quantity: item.quantity + delta } : item).filter(item => item.quantity > 0));
  }

  function checkout() {
    if (!cart.length || !whatsappNumber) return;
    const lines = cart.map(item => `• ${item.name} (SKU: ${item.sku}) × ${item.quantity} = ${money(item.selling_price * item.quantity)}`);
    const message = [
      "Hello MRS Stationery! I would like to enquire about this order:",
      "",
      ...lines,
      "",
      `Total: ${money(cartTotal)}`,
      "",
      "Please confirm availability and order details."
    ].join("\n");
    window.location.href = "https://wa.me/" + whatsappNumber + "?text=" + encodeURIComponent(message);
  }

  return <div className="public-catalogue">
    <header className="catalogue-header">
      <a className="catalogue-brand" href="/catalog"><span className="catalogue-logo">M</span><span><b>{storeName}</b><small>YOUR EVERYDAY STATIONERY STORE</small></span></a>
      <nav className="catalogue-nav" aria-label="Main navigation"><a href="#products">Products</a><a href="#about">About Us</a><a href="#visit">Visit Store</a><a className="catalogue-social-future" href="#social">Social Media <small>Coming soon</small></a></nav>
      <button className="catalogue-cart-button" onClick={() => setCartOpen(true)} aria-label="Open shopping cart">Cart <span>{cartCount}</span></button>
    </header>
    <main className="catalogue-main">
      <section className="catalogue-hero">
        <span className="catalogue-kicker">WELCOME TO MRS STATIONERY</span>
        <h1>Everything you need,<br/>all in one place.</h1>
        <p>Explore our stationery collection and send your shopping list directly to us.</p>
        <div className="catalogue-search"><span>⌕</span><input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search notebooks, pens, art supplies…" aria-label="Search products"/></div>
      </section>
      <section className="catalogue-listing">
        <div className="catalogue-listing-head"><div><span className="catalogue-kicker">OUR COLLECTION</span><h2>Shop stationery</h2><p>{products.length} products available in our catalogue</p></div>
          <select value={category} onChange={e => setCategory(e.target.value)} aria-label="Filter by category">{categories.map(c => <option key={c}>{c}</option>)}</select>
        </div>
        {loading ? <div className="catalogue-state">Loading products…</div>
          : error ? <div className="catalogue-state catalogue-error">{error}</div>
          : !visibleProducts.length ? <div className="catalogue-state">No products found. Try another search or category.</div>
          : <div className="catalogue-grid">{visibleProducts.map(product => <article className="catalogue-product" key={product.product_id}>
              <div className="catalogue-product-art">{product.image_url ? <img src={product.image_url} alt={product.name} loading="lazy"/> : <span>✎</span>}<small>{product.category || "STATIONERY"}</small></div>
              <div className="catalogue-product-info"><span className="catalogue-sku">{product.sku}</span><h3>{product.name}</h3><p className={product.in_stock ? "catalogue-stock" : "catalogue-stock out"}>{product.in_stock ? "● Available" : "● Currently unavailable"}</p><div className="catalogue-product-bottom"><strong>{money(product.selling_price)}</strong><button disabled={!product.in_stock} onClick={() => add(product)}>{product.in_stock ? "＋ Add" : "Out of stock"}</button></div></div>
            </article>)}</div>}
      </section>
      <section className="catalogue-info-section" id="about">
        <div className="catalogue-info-copy"><span className="catalogue-kicker">GET TO KNOW US</span><h2>About MRS Stationery</h2><p>MRS Stationery is your one-stop destination for complete stationery needs. From everyday school and office essentials to art, craft and writing supplies, we aim to offer a wide selection with honest, affordable pricing.</p><p>We believe customers deserve quality products at fair prices, with friendly service they can trust. Whether you are a student, parent, teacher or working professional, we are here to help you find what you need.</p><strong>Complete stationery. Honest pricing. Friendly service.</strong></div>
        <div className="catalogue-about-mark" aria-hidden="true"><span>✎</span><b>Everything for<br/>learning & creating</b><small>YOUR EVERYDAY STATIONERY STORE</small></div>
      </section>
      <section className="catalogue-visit-section" id="visit">
        <div><span className="catalogue-kicker">COME SAY HELLO</span><h2>Visit Our Store</h2><p>We would love to welcome you. Visit MRS Stationery at Ayyampettai, Tamil Nadu, for your complete stationery needs.</p><b>V5VP+JG, Ayyampettai, Tamil Nadu</b><small>Search this Plus Code in Google Maps for directions.</small></div>
        <a className="catalogue-map-link" href="https://www.google.com/maps/search/?api=1&query=V5VP%2BJG%20Ayyampettai%2C%20Tamil%20Nadu" target="_blank" rel="noreferrer">Get directions <span>↗</span></a>
      </section>
      <section className="catalogue-social-section" id="social"><div><span className="catalogue-kicker">STAY CONNECTED</span><h2>Find us on Social Media</h2><p>Our social media pages are coming soon. Check back for updates, new arrivals and special offers.</p></div><span className="catalogue-coming-soon">Coming soon</span></section>
    </main>
    <footer className="catalogue-footer"><b>{storeName}</b><span>Complete stationery · Honest pricing · Friendly service</span><a href="#visit">Visit our store ↑</a></footer>
    {cartOpen && <div className="catalogue-overlay" onClick={() => setCartOpen(false)}>
      <aside className="catalogue-drawer" onClick={e => e.stopPropagation()}>
        <div className="catalogue-drawer-head"><div><span className="catalogue-kicker">YOUR SELECTION</span><h2>Shopping cart ({cartCount})</h2></div><button className="catalogue-close" onClick={() => setCartOpen(false)} aria-label="Close cart">×</button></div>
        {!cart.length ? <div className="catalogue-empty">Your cart is empty.<br/>Add products from the catalogue to get started.</div>
          : <><div className="catalogue-cart-lines">{cart.map(item => <div className="catalogue-cart-line" key={item.product_id}><div className="catalogue-cart-symbol">✎</div><div className="catalogue-cart-detail"><b>{item.name}</b><small>{item.sku} · {money(item.selling_price)}</small><div className="catalogue-quantity"><button onClick={() => changeQuantity(item.product_id, -1)} aria-label={"Decrease " + item.name}>−</button><span>{item.quantity}</span><button onClick={() => changeQuantity(item.product_id, 1)} aria-label={"Increase " + item.name}>＋</button><button className="catalogue-remove" onClick={() => changeQuantity(item.product_id, -item.quantity)}>Remove</button></div></div><strong>{money(item.selling_price * item.quantity)}</strong></div>)}</div>
          <div className="catalogue-cart-total"><span>Estimated total</span><b>{money(cartTotal)}</b></div>
          {whatsappNumber ? <button className="catalogue-checkout" onClick={checkout}>Continue on WhatsApp <span>↗</span></button> : <div className="catalogue-config-note">WhatsApp checkout will be enabled once the store contact number is configured.</div>}
          <p className="catalogue-disclaimer">This is an enquiry, not a confirmed order. Final availability and pricing will be confirmed by the store.</p></>}
      </aside>
    </div>}
  </div>;
}
