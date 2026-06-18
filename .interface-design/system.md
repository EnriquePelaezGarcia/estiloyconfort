# Estilo y Confort — Interface Design System

**Direction:** Architectural minimalism for a luxury furniture store. Like entering a private showroom after hours — composed, purposeful, editorial. Not a generic e-commerce template.

**Target:** Discerning homeowners seeking sophistication and serenity. Products are the focal point; the UI is the frame.

**Feel:** Warm like handmade paper, structural like concrete, quiet like a room with good furniture in it.

---

## Color Tokens

### Brand Scale (Purple)
| Token | Hex | Use |
|-------|-----|-----|
| `ink` | `#1e1521` | Hero bg, login dark panel, darkest CTAs, page darkness |
| `brand-dark` | `#36203b` | Primary brand, nav links, active states |
| `brand-mid` | `#3d2b5e` | Hover states, focus rings, category hover border |
| `brand-light` | `#5c4480` | Overlines, accent text, newsletter btn |
| `depth` | `#2a1d42` | Footer bg, newsletter bg, dark sections |

### Surface Scale (Warm Neutrals)
| Token | Hex | Use |
|-------|-----|-----|
| `porcelain` | `#fcf9f8` | Lightest surface, text on dark, category section bg |
| `linen-warm` | `#f8f5f2` | Login form panel, card backgrounds on light pages |
| `linen-cool` | `#f0ece7` | Arrivals section bg, alternate section tint |
| `surface-low` | `#f6f3f2` | Input bg tint, hover row bg |
| `surface-mid` | `#e5e2e1` | Borders, surface-container-highest |

### Text Hierarchy (on light surfaces)
| Level | Hex | Use |
|-------|-----|-----|
| Primary | `#1e1521` | Headings, key values |
| Secondary | `#625d5a` | Body copy, product prices, supporting text |
| Tertiary | `#8c8480` | Subtitles, form subtitles, muted labels |
| Muted | `rgba(98,93,90,0.4)` | Placeholders, disabled |

### Text on Dark Surfaces
| Level | Value | Use |
|-------|-------|-----|
| Primary | `#fcf9f8` | Headings on hero/footer/newsletter |
| Secondary | `rgba(252,249,248,0.6)` | Body text on dark |
| Muted | `rgba(252,249,248,0.35)` | Links, back buttons, captions |

### Signature Accent
```
rgba(201, 184, 232, _)   // lavender — always this hue, vary opacity only
  0.2  → hairline dividers (login split, subtle borders)
  0.35 → ornament ✦ on dark
  0.4  → footer/newsletter ornament
  0.55 → italic em text on dark
  0.9  → link hover on dark backgrounds
```

### Semantic
| Token | Hex | Use |
|-------|-----|-----|
| `error` | `#b00020` | Validation errors, destructive actions |
| `error-bg` | `rgba(176,0,32,0.05)` | Error banner background |
| `error-border` | `rgba(176,0,32,0.15)` | Error banner border |
| `whatsapp` | `#25D366` | WhatsApp CTA only — hover `#128C7E` |

---

## Typography

Three fonts, three roles — **never swap them**:

| Font | Role | Where |
|------|------|--------|
| **Playfair Display** (serif) | Editorial | Brand name, section titles (h1/h2), page titles, newsletter title, login panel brand |
| **Inter** (sans) | Functional | Body copy, overlines, form labels, buttons, nav links, prices, metadata |
| **Manrope** (sans) | Product | Product names inside cards only |

### Type Scale

```scss
// Overline — precedes every major section title
font-family: 'Inter'; font-size: 0.6875rem; font-weight: 600;
letter-spacing: 0.15em; text-transform: uppercase; color: #5c4480;
// On dark: color: rgba(255,255,255,0.45)

// Section title
font-family: 'Playfair Display'; font-size: clamp(2rem, 4vw, 2.75rem);
font-weight: 400; letter-spacing: -0.01em; line-height: 1.2;

// Hero title
font-family: 'Playfair Display'; font-size: clamp(2.75rem, 6vw, 4.5rem);
font-weight: 400; letter-spacing: -0.02em; line-height: 1.1;

// Body
font-family: 'Inter'; font-size: 1rem / 1.0625rem; line-height: 1.8;

// Label / button
font-family: 'Inter'; font-size: 0.8125rem; font-weight: 600;
letter-spacing: 0.08–0.1em; text-transform: uppercase;

// Product name (cards)
font-family: 'Manrope'; font-size: 1.0625rem; font-weight: 500;
```

### Italic Em Pattern (on dark titles)
Playfair Display headings on dark backgrounds use a faded italic second line:
```html
<h1>Estilo y Confort<br><em>para tu Hogar</em></h1>
```
```scss
em { font-style: italic; color: rgba(252,249,248,0.65); }
// Or lavender tint: color: rgba(201,184,232,0.75);
```

---

## Signature Elements

These appear across the entire product and mark the brand's editorial identity. Never omit them.

### 1 — Ornament ✦
```html
<span class="ornament">✦</span>  <!-- Always Unicode ✦ U+2726 -->
```
```scss
font-size: 0.875rem; letter-spacing: 0.4em;
color: rgba(201, 184, 232, 0.35); // dark backgrounds
color: rgba(92, 68, 128, 0.4);    // light backgrounds
margin-bottom: 1.5–1.75rem;
```
Appears: hero, newsletter, coming-soon, login panel, any editorial section intro.

### 2 — Lavender Hairline Divider
```scss
border-left: 1px solid rgba(201, 184, 232, 0.2);  // login panel split
border-bottom: 1px solid rgba(201, 184, 232, 0.2); // section dividers on dark
```

### 3 — Overline → Title Rhythm
Every major section begins with: overline (`Inter`, uppercase, tracked) then Playfair title. Always in this order, never the title alone.

---

## Depth Strategy: Borders-Only

No dramatic shadows. Elevation through surface color shifts + low-opacity borders.

```
Surface elevation (light to dark):
  Level 0 (dark):  #1e1521  (hero, login panel)
  Level 1 (deep):  #2a1d42  (footer, newsletter)
  Level 2 (linen): #f0ece7  (arrivals section)
  Level 3 (linen): #f8f5f2  (login form panel, cards)
  Level 4 (base):  #fcf9f8  (categories section, page bg)
  Level 5 (white): #ffffff  (inputs on focus, product card imgs)
```

Border progression:
```scss
rgba(61, 43, 94, 0.12)  // subtle — category ring default, input default
rgba(61, 43, 94, 0.18)  // standard — form input borders
rgba(61, 43, 94, 0.35)  // emphasis — login button border
#3d2b5e                  // maximum — active/focus border
```

Focus ring (inputs only):
```scss
box-shadow: 0 0 0 3px rgba(61, 43, 94, 0.09);
```

Allowed shadows: only on auth/modal cards, very diffused:
```scss
box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12);
```

---

## Border Radius Scale

```scss
2px   // primary CTAs (hero btn, submit btn) — sharp, intentional
4px   // form inputs, error banners, small interactive elements
12px  // image wrappers inside category items
16px  // category item ring (outer)
50%   // circular icon buttons (navbar, carousel arrows)
```
**Rule:** Never mix 2px CTAs with rounded CTAs in the same view. Never use 8px+ on button CTAs.

---

## Spacing System

Base unit: `1rem` (16px). Use multiples only.

```scss
0.375rem  // micro: icon-to-text gap, label margin
0.625rem  // small: button gap, action row gap
1rem      // component: between form fields, list items
1.25rem   // category grid gap
1.75rem   // card gap in carousel
2.5rem    // section header gap, nav inner gap
3.5–4rem  // section padding horizontal (desktop)
6rem      // section vertical padding
8rem      // newsletter/hero vertical padding
```

Container:
```scss
max-width: 1400px;  // Angular project standard
max-width: 1440px;  // HTML prototypes (treat as equivalent)
margin: 0 auto;
```

---

## Components

### Hero Section
```scss
height: 92vh; min-height: 560px;
background: #1e1521;
// Dual overlay gradient: left-to-right (content readable) + bottom-to-top (ground)
background:
  linear-gradient(to right, rgba(30,21,33,0.9) 0%, rgba(30,21,33,0.45) 55%, rgba(30,21,33,0.1) 100%),
  linear-gradient(to top, rgba(30,21,33,0.6) 0%, transparent 40%);
```
- `✦` ornament → Playfair title with `<em>` → body text → CTA
- CTA: `border-radius: 2px`, uppercase, `#fcf9f8` bg → `#3d2b5e` hover, arrow icon slides right on hover

### Section Header Pattern
```html
<span class="label-overline">Colecciones</span>
<h2 class="section-title">Explora por Estancia</h2>
```
Always centered for public sections; left-aligned for catalog/admin.

### Category Grid
```scss
display: grid; grid-template-columns: repeat(5, 1fr);
// Full-width — outside max-width container, only small horizontal padding
padding: 0 1.25rem;
```
Item structure: `__ring` (16px radius, 4px padding) wrapping `__img-wrap` (12px radius, overflow hidden). Hover: `border-color: #3d2b5e` + `box-shadow: 0 0 0 4px rgba(61,43,94,0.07)`.

### Product Card (Catalog / Carousel)
```scss
// Image
aspect-ratio: 3/4; // vertical portrait
border-radius: 2px; // very subtle
background: #e3ddd8;

// Hover overlay (inside image)
position: absolute; inset: 0;
background: rgba(30,21,33,0.42);
opacity: 0; transition: opacity 350ms ease;
// Shows "Ver Detalle" button on hover

// Badge (top-left, absolute)
background: #fcf9f8; color: #3d2b5e;
font-size: 0.6rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.12em;
padding: 0.25rem 0.75rem;
```
- Product name: **Manrope** 500
- Price: Inter, `#625d5a`

### Product Detail Page (Image 2 prototype)
```
Layout: 12-col grid, left 7 (gallery) / right 5 (info)
Gallery: scroll-snap horizontal + nav dots + 3-col thumbnails
Color swatches: circular, ring-2 on selected
Size buttons: outlined pill, border-primary on active
Accordion: description + specs
Shipping calculator: surface-container-low bg, postal input + calculate btn
WhatsApp CTA (primary): #25D366 → #128C7E, chat icon filled
Secondary CTA: surface-container-highest, muted
```

### Catalog Page (Image 4 prototype)
```
Editorial header: max-w-3xl, overline + Playfair title + body text
Filter bar: inline text dropdowns (not sidebar), border-bottom separator
Product grid: 3-col, aspect-[4/5]
Card CTA button: full-width, outlined → filled primary on hover
Pagination: centered, active page = filled primary square
```

### Cart Drawer (Image 6 prototype)
```
Position: fixed right-0, h-screen, w-96
Header: title + subtitle + close button
Progress steps: Carrito → Subtotal → Envío → Finalizar (4 icons + labels)
Product row: 80×80 thumbnail + name + price + qty controls (–/+)
Footer: subtotal + shipping + total (Playfair Display for total price)
Checkout CTA: WhatsApp green, full-width
```
Cart total price should use **Playfair Display** for the number — same editorial treatment as product prices on detail page.

### Auth / Login
```
Layout: split-screen grid (1fr 1fr)
Left: #1e1521, ✦ ornament + brand name (Playfair, 2.875rem) + italic tagline + back link
Lavender hairline: border-left: 1px solid rgba(201,184,232,0.2)
Right: #f8f5f2, form flush (no card, no border box)

Overline: "Sistema interno" — Inter, 0.6875rem, uppercase, tracked, #5c4480
Title: Playfair Display, 1.875rem, weight 400, #1e1521

Input:
  border: 1px solid rgba(61,43,94,0.18); border-radius: 4px;
  background: rgba(0,0,0,0.025);
  :focus → bg: white, border: #3d2b5e, ring: rgba(61,43,94,0.09)

Submit:
  background: #1e1521; border-radius: 2px;
  uppercase; letter-spacing: 0.1em;
  hover → #3d2b5e
```

### Newsletter Section
```scss
padding: 8rem 2rem;
background: #2a1d42; // full-bleed, no card
text-align: center;
// ✦ ornament → overline → Playfair title (with <em>) → integrated form
```
Form: input + button flushed inside a single container (no separate card). On mobile: stacks vertically.

### Footer
```scss
background: #2a1d42;
// 4-column grid: brand / nav / contact / legal
max-width: 1400px; padding: 4rem 2.5rem;
// Links hover: rgba(201,184,232,0.9) — not white
// Logo: Playfair Display
// Column headings: Inter, uppercase, tracked, overline style
```

### Coming-Soon / Placeholder
```scss
background: #fcf9f8; min-height: 70vh;
// ✦ ornament → icon (muted) → overline "Próximamente" → Playfair title → body → CTA
CTA: same as hero btn (border-radius: 2px, uppercase, #1e1521 → #3d2b5e)
```

### Navbar
```scss
background: rgba(252,249,248,0.85); backdrop-filter: blur(12px);
border-bottom: 1px solid rgba(98,93,90,0.1);
max-width: 1400px; padding: 1.125rem 2.5rem; gap: 2.5rem;

Brand: Playfair Display, 1.25rem, #36203b
Links: Inter, 1rem, #625d5a, left-aligned after brand
Actions: margin-left: auto → pushed to far right
Login btn: 1.5px border rgba(54,32,59,0.35), border-radius: 4px
```

### Toast Notifications
```scss
// info: #3d2b5e (brand mid)
// success: #2e7d32
// error: #b00020
// border-radius: 6px; animate from right
```

---

## Dark Surface Rules

When a section uses `#1e1521` or `#2a1d42` background:
- All text must use the on-dark hierarchy above
- Borders use lavender: `rgba(201,184,232,0.15–0.2)`
- `✦` ornament must appear at section entry
- Form inputs on dark: increase border opacity, ensure white on focus

---

## Responsive Breakpoints

| Breakpoint | Value | Change |
|-----------|-------|--------|
| Mobile | `max-width: 576px` | Category grid → 2-col, carousel gap reduces |
| Tablet | `max-width: 768px` | Navbar links hidden, login splits collapse, hero padding reduces |
| Desktop | `min-width: 1024px` | Full layout unlocks |
| Wide | `max-width: 1400px` | Container max-width cap |

---

## Patterns to Always Apply

1. **Overline before every title.** No Playfair title without an Inter overline preceding it.
2. **Section rhythm:** dark (`#1e1521` hero) → cream (`#fcf9f8` categories) → linen (`#f0ece7` products) → dark (`#2a1d42` newsletter/footer). Don't break the alternation.
3. **No gradient backgrounds.** Solid surfaces only. The one exception: `radial-gradient` inside the dark hero or login panel is a subtle depth hint, not a decorative gradient.
4. **WhatsApp CTA is always `#25D366`.** It breaks the palette intentionally — it communicates "external action." Never use WhatsApp green for any other button.
5. **Playfair Display never bolded.** Use weight 400 (regular) or 600 max. It's inherently elegant; adding `font-weight: 700` destroys it.
6. **Product names in Manrope only.** Playfair for the store, Manrope for products. This hierarchy is load-bearing.

---

## What NOT to Do

- No floating white card on a dark background (auth uses split layout instead)
- No `justify-content: space-between` on nav (use `margin-left: auto` on actions group)
- No `border-radius: 8px+` on CTA buttons — only inputs/drawers/thumbnails
- No `font-weight: 700` on Playfair Display
- No `box-shadow` on product cards — tonal surface shift only
- No WhatsApp green on internal-system buttons
- No multiple accent colors — lavender is the only accent; `#5c4480` is its on-light expression
