import { useStudioDraft } from "./drafts";
import { useState, useEffect } from "react";
import { T, ss } from "./style";
const PAIR_DB: any[] = [
  // ── CONTRAST: serif display + sans body ──
  {
    s: "contrast",
    display: "Playfair Display",
    body: "Source Sans 3",
    dw: 700,
    bw: 400,
    xh: true,
    why: "High stroke contrast meets open grotesque body.",
    use: "Magazine · Luxury · Editorial",
  },
  {
    s: "contrast",
    display: "Playfair Display",
    body: "Inter",
    dw: 700,
    bw: 400,
    xh: true,
    why: "Elegant display, neutral system body — maximally readable.",
    use: "Blog · Portfolio · SaaS",
  },
  {
    s: "contrast",
    display: "Cormorant Garamond",
    body: "Proza Libre",
    dw: 600,
    bw: 400,
    xh: false,
    why: "Delicate Garamond with a generous, open body face.",
    use: "Fashion · Heritage · Publishing",
  },
  {
    s: "contrast",
    display: "Cormorant Garamond",
    body: "DM Sans",
    dw: 700,
    bw: 400,
    xh: true,
    why: "Aristocratic display, clean modern body.",
    use: "Luxury · High-end editorial",
  },
  {
    s: "contrast",
    display: "Lora",
    body: "Nunito",
    dw: 700,
    bw: 400,
    xh: true,
    why: "Warm bracketed serifs + rounded humanist sans.",
    use: "Lifestyle · Wellness · Food blog",
  },
  {
    s: "contrast",
    display: "Merriweather",
    body: "Open Sans",
    dw: 700,
    bw: 400,
    xh: true,
    why: "Google's own flagship editorial pairing.",
    use: "News · Documentation · Reports",
  },
  {
    s: "contrast",
    display: "EB Garamond",
    body: "Lato",
    dw: 700,
    bw: 300,
    xh: false,
    why: "Renaissance warmth + 20th century geometric cool.",
    use: "Academic · Long-form · Heritage",
  },
  {
    s: "contrast",
    display: "Libre Baskerville",
    body: "Libre Franklin",
    dw: 700,
    bw: 400,
    xh: true,
    why: "Sibling fonts from the same designer — perfect harmony.",
    use: "Journalism · Government · Editorial",
  },
  {
    s: "contrast",
    display: "DM Serif Display",
    body: "DM Sans",
    dw: 400,
    bw: 400,
    xh: true,
    why: "Same type family — designer-matched display/body pair.",
    use: "Product · Marketing · Web app",
  },
  {
    s: "contrast",
    display: "Fraunces",
    body: "Inter",
    dw: 700,
    bw: 400,
    xh: true,
    why: "Optical size serif designed for headlines + neutral body.",
    use: "Poster · Branding · Web",
  },
  {
    s: "contrast",
    display: "Spectral",
    body: "Source Sans 3",
    dw: 700,
    bw: 400,
    xh: true,
    why: "Book-grade serif display against clean sans body.",
    use: "Publishing · Long-form · Literary",
  },
  {
    s: "contrast",
    display: "Crimson Pro",
    body: "Work Sans",
    dw: 700,
    bw: 400,
    xh: true,
    why: "Scholarly display meets utilitarian sans.",
    use: "Research · Nonprofit · Editorial",
  },
  {
    s: "contrast",
    display: "Tenor Sans",
    body: "Raleway",
    dw: 400,
    bw: 300,
    xh: true,
    why: "Two light, airy typefaces — elegant, fashion-forward.",
    use: "Fashion · Lifestyle · Minimal",
  },

  // ── HUMANIST: condensed headline + sans body ──
  {
    s: "humanist",
    display: "Oswald",
    body: "Hind",
    dw: 600,
    bw: 400,
    xh: true,
    why: "Classic web pairing — condensed headlines, Indian-influenced body.",
    use: "News · Sports · Web",
  },
  {
    s: "humanist",
    display: "Oswald",
    body: "Source Sans 3",
    dw: 600,
    bw: 400,
    xh: true,
    why: "Condensed display, versatile humanist body.",
    use: "Poster · Sports · Editorial",
  },
  {
    s: "humanist",
    display: "Barlow Condensed",
    body: "Barlow",
    dw: 700,
    bw: 400,
    xh: true,
    why: "Same family — condensed + regular is a designer-approved cheat code.",
    use: "Brand · Presentation · Web",
  },
  {
    s: "humanist",
    display: "Josefin Sans",
    body: "Josefin Slab",
    dw: 700,
    bw: 300,
    xh: false,
    why: "Geometric pair from the same designer — rare matching elegance.",
    use: "Fashion · Minimal · Poster",
  },
  {
    s: "humanist",
    display: "Raleway",
    body: "Raleway",
    dw: 800,
    bw: 300,
    xh: true,
    why: "One family, radical weight contrast. Weight IS the hierarchy.",
    use: "Landing page · Portfolio · Minimal",
  },
  {
    s: "humanist",
    display: "Fjalla One",
    body: "Cantarell",
    dw: 400,
    bw: 400,
    xh: true,
    why: "Heavy condensed + GNOME's clean humanist body.",
    use: "Tech · App · Linux-adjacent",
  },
  {
    s: "humanist",
    display: "Bebas Neue",
    body: "Roboto",
    dw: 400,
    bw: 400,
    xh: false,
    why: "Street-level poster display + Google's workhorse body.",
    use: "Streetwear · Gym · Poster",
  },
  {
    s: "humanist",
    display: "Bebas Neue",
    body: "Open Sans",
    dw: 400,
    bw: 400,
    xh: false,
    why: "All-caps drama + the most web-safe body font alive.",
    use: "Event · Brand · Digital",
  },
  {
    s: "humanist",
    display: "Anton",
    body: "Roboto",
    dw: 400,
    bw: 300,
    xh: false,
    why: "Extreme weight contrast — attention-grabbing poster energy.",
    use: "Sports · Entertainment · Promo",
  },
  {
    s: "humanist",
    display: "Righteous",
    body: "Nunito",
    dw: 400,
    bw: 400,
    xh: true,
    why: "Retro display + rounded friendly body.",
    use: "Games · Kids · Fun brand",
  },
  {
    s: "humanist",
    display: "Russo One",
    body: "Roboto",
    dw: 400,
    bw: 400,
    xh: true,
    why: "Boxy, technical display + clean neutral body.",
    use: "Tech · Gaming · App",
  },
  {
    s: "humanist",
    display: "Pathway Gothic One",
    body: "Source Sans 3",
    dw: 400,
    bw: 400,
    xh: true,
    why: "Extremely condensed newsprint display + open body.",
    use: "News · Politics · Event",
  },

  // ── MONO ACCENT ──
  {
    s: "mono",
    display: "Space Grotesk",
    body: "Space Mono",
    dw: 600,
    bw: 400,
    xh: true,
    why: "Space family pair — designed to work together. Technical poetry.",
    use: "Dev tools · Code blog · Tech brand",
  },
  {
    s: "mono",
    display: "IBM Plex Sans",
    body: "IBM Plex Mono",
    dw: 600,
    bw: 400,
    xh: true,
    why: "IBM's own system — the gold standard of corporate type families.",
    use: "Enterprise · SaaS · Documentation",
  },
  {
    s: "mono",
    display: "Manrope",
    body: "DM Mono",
    dw: 700,
    bw: 400,
    xh: true,
    why: "Friendly geometric + clean monospaced body.",
    use: "Startup · Dev product · Technical",
  },
  {
    s: "mono",
    display: "Inter",
    body: "JetBrains Mono",
    dw: 600,
    bw: 400,
    xh: true,
    why: "The definitive developer UI pairing.",
    use: "IDE · Dev tool · Code documentation",
  },
  {
    s: "mono",
    display: "Outfit",
    body: "Roboto Mono",
    dw: 600,
    bw: 400,
    xh: true,
    why: "Modern geometric display + Google's monospaced body.",
    use: "Tech startup · SaaS dashboard",
  },
  {
    s: "mono",
    display: "Exo 2",
    body: "Share Tech Mono",
    dw: 700,
    bw: 400,
    xh: true,
    why: "Sci-fi geometric display + technical monospaced body.",
    use: "Gaming · Sci-fi · Tech",
  },
  {
    s: "mono",
    display: "Rajdhani",
    body: "Source Code Pro",
    dw: 600,
    bw: 400,
    xh: true,
    why: "Devanagari-influenced display + code body — unique, memorable.",
    use: "Data product · Terminal · Dev",
  },

  // ── SLAB POWER ──
  {
    s: "slab",
    display: "Arvo",
    body: "Lato",
    dw: 700,
    bw: 400,
    xh: false,
    why: "Geometric slab + humanist sans — balanced journalistic pair.",
    use: "News · Blog · Editorial",
  },
  {
    s: "slab",
    display: "Rokkitt",
    body: "Open Sans",
    dw: 700,
    bw: 400,
    xh: true,
    why: "Slab headline energy with highly legible body.",
    use: "Marketing · Presentation · Web",
  },
  {
    s: "slab",
    display: "Zilla Slab",
    body: "Fira Sans",
    dw: 700,
    bw: 400,
    xh: true,
    why: "Mozilla's own pair — clean slab + humanist body.",
    use: "Firefox · Open source · Brand",
  },
  {
    s: "slab",
    display: "Bitter",
    body: "Raleway",
    dw: 700,
    bw: 300,
    xh: true,
    why: "News slab + editorial geometric — confident and clean.",
    use: "Magazine · News · Blog",
  },
  {
    s: "slab",
    display: "Crete Round",
    body: "Nunito Sans",
    dw: 400,
    bw: 400,
    xh: false,
    why: "Soft slab curves pair with Nunito's round friendly feel.",
    use: "Food · Lifestyle · Friendly brand",
  },
  {
    s: "slab",
    display: "Alfa Slab One",
    body: "Source Sans 3",
    dw: 400,
    bw: 400,
    xh: false,
    why: "Maximum slab weight + neutral open body.",
    use: "Sports · Entertainment · Bold brand",
  },
  {
    s: "slab",
    display: "Roboto Slab",
    body: "Roboto",
    dw: 700,
    bw: 400,
    xh: true,
    why: "The Google-matched slab/sans pair. Practically foolproof.",
    use: "Product · Documentation · App",
  },
  {
    s: "slab",
    display: "Rockwell",
    body: "Gill Sans",
    dw: 700,
    bw: 400,
    xh: true,
    why: "Classic slab + classic humanist — British editorial tradition.",
    use: "Heritage · Print · Formal",
  },

  // ── SERIF STACK ──
  {
    s: "serif-serif",
    display: "Playfair Display",
    body: "Lora",
    dw: 700,
    bw: 400,
    xh: true,
    why: "Both transitional serifs — different optical sizes, same spirit.",
    use: "Literary · Blog · Publishing",
  },
  {
    s: "serif-serif",
    display: "Cormorant Garamond",
    body: "EB Garamond",
    dw: 700,
    bw: 400,
    xh: false,
    why: "Two Garamonds — one display-cut, one text-cut. Sophisticated layering.",
    use: "Academic · Heritage · Luxury",
  },
  {
    s: "serif-serif",
    display: "Abril Fatface",
    body: "Lora",
    dw: 400,
    bw: 400,
    xh: false,
    why: "Fat display serif + refined text serif — editorial magazine feel.",
    use: "Magazine · Fashion · Culture",
  },
  {
    s: "serif-serif",
    display: "Rufina",
    body: "Libre Baskerville",
    dw: 700,
    bw: 400,
    xh: false,
    why: "Decorative serif display + sturdy text serif body.",
    use: "Artisan · Print · Brand",
  },
  {
    s: "serif-serif",
    display: "DM Serif Display",
    body: "Lora",
    dw: 400,
    bw: 400,
    xh: true,
    why: "Optical display cut + high-quality text cut — matched x-height.",
    use: "Editorial · Web magazine",
  },
  {
    s: "serif-serif",
    display: "Fraunces",
    body: "Crimson Pro",
    dw: 700,
    bw: 400,
    xh: false,
    why: "Variable optical size display + elegant text serif.",
    use: "Literary · Publishing · Culture",
  },
  {
    s: "serif-serif",
    display: "Playfair Display",
    body: "PT Serif",
    dw: 700,
    bw: 400,
    xh: true,
    why: "Elegant display + versatile Cyrillic-origin text serif.",
    use: "International editorial · Long-form",
  },
  {
    s: "serif-serif",
    display: "Libre Caslon Display",
    body: "Libre Caslon Text",
    dw: 400,
    bw: 400,
    xh: true,
    why: "Display/text cut siblings from the Caslon revival. Purist.",
    use: "Publishing · Heritage · Long-form",
  },

  // ── DISPLAY DRAMA ──
  {
    s: "display-drama",
    display: "Oswald",
    body: "Merriweather",
    dw: 700,
    bw: 300,
    xh: true,
    why: "Condensed power + warm bracketed serif body.",
    use: "News · Editorial · Magazine",
  },
  {
    s: "display-drama",
    display: "Bebas Neue",
    body: "Libre Baskerville",
    dw: 400,
    bw: 400,
    xh: false,
    why: "All-caps tension + literary body serif.",
    use: "Film · Poster · Dramatic brand",
  },
  {
    s: "display-drama",
    display: "Barlow Condensed",
    body: "Lora",
    dw: 700,
    bw: 400,
    xh: true,
    why: "Tight condensed headline over warm text serif.",
    use: "Magazine · Feature article",
  },
  {
    s: "display-drama",
    display: "Fjalla One",
    body: "Merriweather",
    dw: 400,
    bw: 300,
    xh: false,
    why: "Heavy condensed + Georgia-class serif body.",
    use: "News · Nonprofit · Editorial",
  },
  {
    s: "display-drama",
    display: "Abril Fatface",
    body: "Crimson Text",
    dw: 400,
    bw: 400,
    xh: false,
    why: "Ultra-fat display + elegant text serif — magazine front pages.",
    use: "Culture · Lifestyle · Magazine",
  },
  {
    s: "display-drama",
    display: "Anton",
    body: "Playfair Display",
    dw: 400,
    bw: 400,
    xh: false,
    why: "Brutal weight followed by elegant serif body — theatrical.",
    use: "Film · Event · Dramatic poster",
  },
  {
    s: "display-drama",
    display: "Righteous",
    body: "Lora",
    dw: 400,
    bw: 400,
    xh: false,
    why: "Retro display + editorial serif body.",
    use: "Retro brand · Magazine · Culture",
  },
  {
    s: "display-drama",
    display: "Teko",
    body: "Hind",
    dw: 600,
    bw: 400,
    xh: true,
    why: "Devanagari-inspired condensed display + Indic humanist body.",
    use: "South Asian · Publishing · Brand",
  },

  // ── GROTESQUE ──
  {
    s: "grotesque",
    display: "Inter",
    body: "Inter",
    dw: 800,
    bw: 400,
    xh: true,
    why: "One font, weight is the only tool. Swiss clarity.",
    use: "Product · Dashboard · App",
  },
  {
    s: "grotesque",
    display: "Manrope",
    body: "Manrope",
    dw: 800,
    bw: 300,
    xh: true,
    why: "Variable font — 800 vs 300 = dramatic hierarchy from one typeface.",
    use: "SaaS · Landing page · Minimal",
  },
  {
    s: "grotesque",
    display: "Space Grotesk",
    body: "DM Sans",
    dw: 700,
    bw: 400,
    xh: true,
    why: "Two modern grotesques — slightly different personalities, same modernist DNA.",
    use: "Tech · Startup · Product",
  },
  {
    s: "grotesque",
    display: "Plus Jakarta Sans",
    body: "Inter",
    dw: 700,
    bw: 400,
    xh: true,
    why: "Warm geometric headline + neutral system body.",
    use: "Startup · App · Web",
  },
  {
    s: "grotesque",
    display: "Outfit",
    body: "Nunito",
    dw: 700,
    bw: 400,
    xh: true,
    why: "Friendly geometric pair — both rounded, both warm.",
    use: "Consumer · Lifestyle · App",
  },
  {
    s: "grotesque",
    display: "Nunito",
    body: "Nunito",
    dw: 800,
    bw: 300,
    xh: true,
    why: "Variable weight contrast within one rounded typeface.",
    use: "Kids · Education · Friendly",
  },
  {
    s: "grotesque",
    display: "Jost",
    body: "DM Sans",
    dw: 700,
    bw: 400,
    xh: true,
    why: "Futura-like geometric + contemporary DM Sans.",
    use: "Brand · Minimal · Future",
  },
  {
    s: "grotesque",
    display: "Urbanist",
    body: "Inter",
    dw: 700,
    bw: 400,
    xh: true,
    why: "Urban geometric display + reliable Inter body.",
    use: "Urban · Real estate · Product",
  },
  {
    s: "grotesque",
    display: "Lexend",
    body: "Noto Sans",
    dw: 700,
    bw: 400,
    xh: true,
    why: "Accessibility-optimized pair — wide-aperture fonts for readability.",
    use: "Education · Accessibility · Healthcare",
  },
  {
    s: "grotesque",
    display: "Work Sans",
    body: "Work Sans",
    dw: 700,
    bw: 300,
    xh: true,
    why: "Variable grotesque — pure weight contrast within one family.",
    use: "Agency · Portfolio · Professional",
  },

  // ── NEW PAIRS ──
  {
    s: "contrast",
    display: "Quattrocento",
    body: "Quattrocento Sans",
    dw: 700,
    bw: 400,
    xh: true,
    why: "Sibling pair from same designer — serif display with matching sans body.",
    use: "Classic · Formal · Elegant",
  },
  {
    s: "contrast",
    display: "Noto Serif",
    body: "Inter",
    dw: 700,
    bw: 400,
    xh: true,
    why: "Google's own global-first pair — maximum language coverage.",
    use: "International · Multilingual · Editorial",
  },
  {
    s: "contrast",
    display: "Prata",
    body: "Red Hat Text",
    dw: 400,
    bw: 400,
    xh: true,
    why: "High-contrast display serif + clean technical sans body.",
    use: "Brand · Luxury · Product",
  },
  {
    s: "contrast",
    display: "Instrument Serif",
    body: "Instrument Sans",
    dw: 400,
    bw: 400,
    xh: true,
    why: "Figma's own family — display and sans cut from the same DNA.",
    use: "Design tools · Product · Web app",
  },
  {
    s: "contrast",
    display: "Eczar",
    body: "Libre Franklin",
    dw: 700,
    bw: 400,
    xh: true,
    why: "Devanagari-inspired display serif + American grotesque body.",
    use: "Multilingual · Editorial · Brand",
  },
  {
    s: "contrast",
    display: "Marcellus",
    body: "DM Sans",
    dw: 400,
    bw: 400,
    xh: false,
    why: "Lapidary Roman display + contemporary geometric body — understated elegance.",
    use: "Luxury · Portfolio · Architecture",
  },
  {
    s: "contrast",
    display: "Lora",
    body: "Open Sans",
    dw: 700,
    bw: 400,
    xh: true,
    why: "Warm contemporary serif + Google's most-used sans body.",
    use: "Blog · E-commerce · Marketing",
  },
  {
    s: "contrast",
    display: "Playfair Display",
    body: "Raleway",
    dw: 700,
    bw: 300,
    xh: false,
    why: "Classic editorial display + elegant thin sans body — fashion-editorial.",
    use: "Fashion · Luxury · Lifestyle blog",
  },
  {
    s: "contrast",
    display: "Cormorant Garamond",
    body: "Raleway",
    dw: 600,
    bw: 300,
    xh: false,
    why: "Refined Garamond + thin geometric sans — haute-couture feeling.",
    use: "Fashion · Bridal · High-end",
  },
  {
    s: "contrast",
    display: "Fraunces",
    body: "Epilogue",
    dw: 700,
    bw: 400,
    xh: true,
    why: "Variable optical serif + crisp neutral grotesque body.",
    use: "Startup · Creative · Web",
  },
  {
    s: "contrast",
    display: "Lora",
    body: "Montserrat",
    dw: 700,
    bw: 400,
    xh: true,
    why: "Warm serif + geometric urban sans — approachable editorial.",
    use: "Blog · Small business · Marketing",
  },
  {
    s: "contrast",
    display: "Playfair Display",
    body: "Lato",
    dw: 700,
    bw: 300,
    xh: false,
    why: "Traditional display charm + modern humanist clarity.",
    use: "Magazine · Lifestyle · Creative",
  },
  {
    s: "contrast",
    display: "Libre Baskerville",
    body: "Montserrat",
    dw: 700,
    bw: 400,
    xh: true,
    why: "Sturdy text serif + geometric grotesque — clean and authoritative.",
    use: "Business · Nonprofit · Editorial",
  },
  {
    s: "contrast",
    display: "Merriweather",
    body: "Lato",
    dw: 700,
    bw: 300,
    xh: true,
    why: "Readability-optimized serif + light humanist body.",
    use: "Blog · Documentation · News",
  },
  {
    s: "contrast",
    display: "Montagu Slab",
    body: "Figtree",
    dw: 700,
    bw: 400,
    xh: true,
    why: "Contemporary optical slab + friendly rounded sans.",
    use: "Brand · Product · Lifestyle",
  },
  {
    s: "contrast",
    display: "Prata",
    body: "Manrope",
    dw: 400,
    bw: 400,
    xh: false,
    why: "Display-weight serif + clean geometric body — confident brand voice.",
    use: "Luxury · Brand · Portfolio",
  },
  {
    s: "contrast",
    display: "Unica One",
    body: "Crimson Text",
    dw: 400,
    bw: 400,
    xh: false,
    why: "Geometric condensed display meets warm humanist text serif.",
    use: "Editorial · Literary · Art direction",
  },
  {
    s: "contrast",
    display: "Cinzel",
    body: "Fauna One",
    dw: 400,
    bw: 400,
    xh: false,
    why: "Roman lapidary capitals with a soft organic text body — classical gravitas.",
    use: "Luxury · Wedding · Heritage brands",
  },
  {
    s: "contrast",
    display: "Yeseva One",
    body: "Josefin Sans",
    dw: 400,
    bw: 300,
    xh: false,
    why: "Feminine serif display with a geometric art-deco body — refined contrast.",
    use: "Fashion · Lifestyle · Creative studio",
  },
  {
    s: "contrast",
    display: "League Spartan",
    body: "Libre Baskerville",
    dw: 700,
    bw: 400,
    xh: true,
    why: "Geometric strength meets serif elegance — bold sans with refined text body.",
    use: "Corporate · Portfolio · Professional",
  },
  {
    s: "contrast",
    display: "Chonburi",
    body: "Domine",
    dw: 400,
    bw: 400,
    xh: false,
    why: "Thai-influenced display with a sturdy news serif body — distinctive and readable.",
    use: "Editorial · Cultural · Multilingual",
  },

  {
    s: "humanist",
    display: "Rubik",
    body: "Open Sans",
    dw: 700,
    bw: 400,
    xh: true,
    why: "Slightly rounded grotesque + the most neutral open body.",
    use: "Food · Lifestyle · Friendly web",
  },
  {
    s: "humanist",
    display: "Montserrat",
    body: "Open Sans",
    dw: 700,
    bw: 400,
    xh: true,
    why: "The most popular Google pairing — urban geometric meets open humanist.",
    use: "Business · Marketing · Landing page",
  },
  {
    s: "humanist",
    display: "Montserrat",
    body: "Roboto",
    dw: 700,
    bw: 400,
    xh: true,
    why: "Buenos Aires geometry + Google's universal body — clean and modern.",
    use: "App · SaaS · Brand",
  },
  {
    s: "humanist",
    display: "Montserrat",
    body: "Raleway",
    dw: 900,
    bw: 300,
    xh: true,
    why: "Maximum weight Montserrat Black + Raleway thin — extreme contrast.",
    use: "Landing page · Poster · Minimal",
  },
  {
    s: "humanist",
    display: "Bebas Neue",
    body: "Heebo",
    dw: 400,
    bw: 300,
    xh: false,
    why: "All-caps condensed drama + light Hebrew-origin humanist body.",
    use: "Gym · Sports · Event",
  },
  {
    s: "humanist",
    display: "Oswald",
    body: "Roboto",
    dw: 600,
    bw: 400,
    xh: true,
    why: "Reliable condensed pair — both Google-native, both widely used.",
    use: "News · Product · Documentation",
  },
  {
    s: "humanist",
    display: "Epilogue",
    body: "Barlow",
    dw: 700,
    bw: 400,
    xh: true,
    why: "Display-weight grotesque + low-contrast humanist body — calm and modern.",
    use: "SaaS · Agency · Web",
  },
  {
    s: "humanist",
    display: "Syncopate",
    body: "Roboto Serif",
    dw: 700,
    bw: 400,
    xh: false,
    why: "All-caps geometric display + Roboto's serif variant — graphic and modern.",
    use: "Brand · Poster · Architecture",
  },
  {
    s: "humanist",
    display: "Syne",
    body: "Syne",
    dw: 800,
    bw: 400,
    xh: true,
    why: "Variable grotesque family — display and text weights from one typeface.",
    use: "Agency · Creative · Portfolio",
  },
  {
    s: "humanist",
    display: "Bricolage Grotesque",
    body: "Manrope",
    dw: 700,
    bw: 400,
    xh: true,
    why: "Variable display grotesque + clean geometric body — contemporary.",
    use: "Agency · Tech · Creative",
  },
  {
    s: "humanist",
    display: "Albert Sans",
    body: "Barlow",
    dw: 700,
    bw: 400,
    xh: true,
    why: "Low-contrast neo-grotesque + humanist Barlow — calm, professional.",
    use: "Corporate · SaaS · Product",
  },
  {
    s: "humanist",
    display: "Corben",
    body: "Montserrat",
    dw: 700,
    bw: 400,
    xh: false,
    why: "Quirky display + versatile geometric body — fun and distinct.",
    use: "Food · Retail · Creative brand",
  },
  {
    s: "humanist",
    display: "Phudu",
    body: "Onest",
    dw: 700,
    bw: 400,
    xh: true,
    why: "Contemporary display grotesque + versatile humanist body.",
    use: "Tech · Product · Modern web",
  },
  {
    s: "humanist",
    display: "Fugaz One",
    body: "Work Sans",
    dw: 400,
    bw: 400,
    xh: false,
    why: "Condensed display energy + utilitarian grotesque body — impact and clarity.",
    use: "Sports · Event · Bold brand",
  },
  {
    s: "humanist",
    display: "Oswald",
    body: "Source Serif 4",
    dw: 600,
    bw: 400,
    xh: true,
    why: "Condensed sans headline over Google's variable text serif — editorial authority.",
    use: "News · Magazine · Feature article",
  },
  {
    s: "humanist",
    display: "Sacramento",
    body: "Poppins",
    dw: 400,
    bw: 400,
    xh: false,
    why: "Script elegance balanced by a modern geometric sans body — playful and refined.",
    use: "Lifestyle blog · Boutique · Creative business",
  },
  {
    s: "humanist",
    display: "Sacramento",
    body: "Lato",
    dw: 400,
    bw: 300,
    xh: false,
    why: "Flowing script display with a humanist light body — delicate and approachable.",
    use: "Wedding · Beauty · Artisan brand",
  },
  {
    s: "humanist",
    display: "Grand Hotel",
    body: "Lato",
    dw: 400,
    bw: 300,
    xh: false,
    why: "Ornate script display with a clean light humanist body — glamour meets clarity.",
    use: "Luxury · Hospitality · Event",
  },
  {
    s: "humanist",
    display: "Arima Madurai",
    body: "Mulish",
    dw: 700,
    bw: 400,
    xh: true,
    why: "Rounded display with Devanagari warmth + clean geometric sans body — friendly and global.",
    use: "Education · Multilingual · Friendly brand",
  },

  {
    s: "mono",
    display: "Syne",
    body: "Space Mono",
    dw: 800,
    bw: 400,
    xh: true,
    why: "Bold variable grotesque + monospaced body — creative studio energy.",
    use: "Studio · Portfolio · Creative tech",
  },
  {
    s: "mono",
    display: "Space Grotesk",
    body: "IBM Plex Mono",
    dw: 700,
    bw: 400,
    xh: true,
    why: "Retro-tech display + IBM's corporate monospaced — systematic.",
    use: "Enterprise tech · Data · SaaS",
  },
  {
    s: "mono",
    display: "Bricolage Grotesque",
    body: "DM Mono",
    dw: 700,
    bw: 400,
    xh: true,
    why: "Contemporary display + clean mono body — developer product feel.",
    use: "Dev tool · API docs · Tech brand",
  },
  {
    s: "mono",
    display: "Space Mono",
    body: "Plus Jakarta Sans",
    dw: 700,
    bw: 400,
    xh: true,
    why: "Retro monospaced display + contemporary geometric sans body — technical meets modern.",
    use: "Dev tool · Portfolio · Creative tech",
  },

  {
    s: "slab",
    display: "Roboto Slab",
    body: "Lato",
    dw: 700,
    bw: 300,
    xh: true,
    why: "Google slab family + lightweight humanist body — authoritative yet approachable.",
    use: "Business · Blog · Report",
  },
  {
    s: "slab",
    display: "Bitter",
    body: "Open Sans",
    dw: 700,
    bw: 400,
    xh: true,
    why: "News-grade slab + the web's most-used sans — journalistic powerhouse.",
    use: "News · Content marketing · Blog",
  },
  {
    s: "slab",
    display: "Arvo",
    body: "Open Sans",
    dw: 700,
    bw: 400,
    xh: false,
    why: "Geometric slab display + open humanist body — structural and clear.",
    use: "Design system · Product · Web",
  },
  {
    s: "slab",
    display: "Zilla Slab",
    body: "Source Sans 3",
    dw: 700,
    bw: 400,
    xh: true,
    why: "Mozilla's slab + versatile Source sans — trusted, readable pair.",
    use: "Tech brand · Documentation · Blog",
  },
  {
    s: "slab",
    display: "Lexend",
    body: "Zilla Slab",
    dw: 700,
    bw: 400,
    xh: true,
    why: "Accessibility display + slab body — highly legible, educational.",
    use: "E-learning · Healthcare · Accessibility",
  },
  {
    s: "slab",
    display: "Work Sans",
    body: "Bitter",
    dw: 700,
    bw: 400,
    xh: true,
    why: "Sans headline + slab body — inverts convention for editorial richness.",
    use: "Magazine · Blog · Editorial",
  },
  {
    s: "slab",
    display: "Montagu Slab",
    body: "Source Sans 3",
    dw: 700,
    bw: 400,
    xh: true,
    why: "Modern optical slab + versatile sans body — design-system ready.",
    use: "Product · Brand · Web",
  },
  {
    s: "slab",
    display: "Ultra",
    body: "Slabo 27px",
    dw: 400,
    bw: 400,
    xh: false,
    why: "Maximum-weight slab display + a text-optimized serif body — extreme editorial contrast.",
    use: "Poster · Magazine · Bold editorial",
  },

  {
    s: "serif-serif",
    display: "Quattrocento",
    body: "Fanwood Text",
    dw: 700,
    bw: 400,
    xh: false,
    why: "Classical Italian roman + American text serif — old-world literary.",
    use: "Academic · Heritage · Publishing",
  },
  {
    s: "serif-serif",
    display: "Abril Fatface",
    body: "Crimson Pro",
    dw: 400,
    bw: 400,
    xh: false,
    why: "Ultra-fat display + refined scholarly text serif.",
    use: "Culture · Literary · Magazine",
  },
  {
    s: "serif-serif",
    display: "Lora",
    body: "Crimson Pro",
    dw: 700,
    bw: 400,
    xh: true,
    why: "Contemporary text serif + elegant old-style body — layered warmth.",
    use: "Literary · Blog · Publishing",
  },
  {
    s: "serif-serif",
    display: "Playfair Display",
    body: "Merriweather",
    dw: 700,
    bw: 300,
    xh: true,
    why: "Editorial display + highly readable text serif — full serif system.",
    use: "Magazine · Publishing · Blog",
  },
  {
    s: "serif-serif",
    display: "Cormorant Garamond",
    body: "Lora",
    dw: 700,
    bw: 400,
    xh: false,
    why: "Display Garamond + contemporary text serif — refined typographic warmth.",
    use: "Luxury · Heritage · Fashion",
  },
  {
    s: "serif-serif",
    display: "DM Serif Display",
    body: "Crimson Pro",
    dw: 400,
    bw: 400,
    xh: true,
    why: "Optical display cut + elegant text cut — matched visual weight.",
    use: "Editorial · Brand · Blog",
  },
  {
    s: "serif-serif",
    display: "Spectral",
    body: "Lora",
    dw: 700,
    bw: 400,
    xh: true,
    why: "Book-grade display + warm text serif — pure literary system.",
    use: "Long-form · Publishing · Literary",
  },

  {
    s: "display-drama",
    display: "Modak",
    body: "Fira Sans",
    dw: 400,
    bw: 400,
    xh: false,
    why: "Ultra-bold display + clean humanist body — playful yet readable.",
    use: "Kids · Food · Fun brand",
  },
  {
    s: "display-drama",
    display: "Calistoga",
    body: "IBM Plex Sans",
    dw: 400,
    bw: 400,
    xh: false,
    why: "Heavy display with ink traps + rational corporate body.",
    use: "Brand · Poster · Type specimen",
  },
  {
    s: "display-drama",
    display: "Oswald",
    body: "Lora",
    dw: 700,
    bw: 400,
    xh: true,
    why: "Condensed sans + warm serif body — news editorial power.",
    use: "News · Magazine · Editorial",
  },
  {
    s: "display-drama",
    display: "Bebas Neue",
    body: "Lora",
    dw: 400,
    bw: 400,
    xh: false,
    why: "All-caps display drama + scholarly serif body — stark contrast.",
    use: "Poster · Magazine · Film",
  },
  {
    s: "display-drama",
    display: "Barlow Condensed",
    body: "Merriweather",
    dw: 700,
    bw: 300,
    xh: true,
    why: "Tight condensed sans + wide-set readable serif — editorial authority.",
    use: "Feature · Long-form · News",
  },
  {
    s: "display-drama",
    display: "Anton",
    body: "Lora",
    dw: 400,
    bw: 400,
    xh: false,
    why: "Ultra-heavy display + elegant text serif — maximum weight contrast.",
    use: "Poster · Sports · Dramatic",
  },
  {
    s: "display-drama",
    display: "Fjalla One",
    body: "Libre Baskerville",
    dw: 400,
    bw: 400,
    xh: false,
    why: "Heavy condensed display + reliable text serif body.",
    use: "News · Nonprofit · Editorial",
  },
  {
    s: "display-drama",
    display: "Yeseva One",
    body: "Crimson Text",
    dw: 400,
    bw: 400,
    xh: false,
    why: "Decorative serif display with an elegant literary text body — dramatic editorial warmth.",
    use: "Culture · Literary · Magazine",
  },

  {
    s: "grotesque",
    display: "Montserrat",
    body: "Montserrat",
    dw: 900,
    bw: 300,
    xh: true,
    why: "Montserrat Black vs Light — one typeface, maximum weight drama.",
    use: "Landing page · Poster · Bold brand",
  },
  {
    s: "grotesque",
    display: "Raleway",
    body: "Open Sans",
    dw: 700,
    bw: 400,
    xh: true,
    why: "Display geometric + open humanist — elegant modern web pairing.",
    use: "Portfolio · Agency · Lifestyle",
  },
  {
    s: "grotesque",
    display: "Rubik",
    body: "Rubik",
    dw: 700,
    bw: 300,
    xh: true,
    why: "Rounded variable grotesque — weight contrast within one warm family.",
    use: "App · Product · Friendly brand",
  },
  {
    s: "grotesque",
    display: "Poppins",
    body: "Poppins",
    dw: 700,
    bw: 300,
    xh: true,
    why: "Geometric circular grotesque — weight contrast, perfectly rounded.",
    use: "Brand · App · Consumer product",
  },
  {
    s: "grotesque",
    display: "Poppins",
    body: "Open Sans",
    dw: 700,
    bw: 400,
    xh: true,
    why: "Geometric circular headline + neutral open body — energetic and clean.",
    use: "E-commerce · Marketing · App",
  },
  {
    s: "grotesque",
    display: "Nunito",
    body: "Open Sans",
    dw: 700,
    bw: 400,
    xh: true,
    why: "Rounded geometric headline + open humanist body — warm approachable pair.",
    use: "Wellness · Education · Lifestyle",
  },
  {
    s: "grotesque",
    display: "Karla",
    body: "Karla",
    dw: 700,
    bw: 400,
    xh: true,
    why: "Variable grotesque with Kannada roots — elegant weight contrast.",
    use: "Brand · Minimal · International",
  },
  {
    s: "grotesque",
    display: "Figtree",
    body: "Inter",
    dw: 700,
    bw: 400,
    xh: true,
    why: "Modern friendly grotesque + reliable system body — contemporary product.",
    use: "SaaS · App · Modern web",
  },
  {
    s: "grotesque",
    display: "Syne",
    body: "Inter",
    dw: 800,
    bw: 400,
    xh: true,
    why: "Creative variable display + neutral system body — agency feel.",
    use: "Agency · Portfolio · Creative",
  },
  {
    s: "grotesque",
    display: "Onest",
    body: "Onest",
    dw: 700,
    bw: 300,
    xh: true,
    why: "Contemporary variable grotesque — systematic weight hierarchy.",
    use: "Tech · Product · Modern",
  },
  {
    s: "grotesque",
    display: "Epilogue",
    body: "Inter",
    dw: 700,
    bw: 400,
    xh: true,
    why: "Display grotesque + neutral system body — clear hierarchy.",
    use: "SaaS · Product · Documentation",
  },
  {
    s: "grotesque",
    display: "Albert Sans",
    body: "Inter",
    dw: 700,
    bw: 400,
    xh: true,
    why: "Warm neo-grotesque + neutral system body — approachable authority.",
    use: "Startup · App · Corporate",
  },
  {
    s: "grotesque",
    display: "PT Sans",
    body: "PT Sans",
    dw: 700,
    bw: 400,
    xh: true,
    why: "Paratype's humanist grotesque — weight contrast within one global family.",
    use: "Government · International · Publication",
  },
  {
    s: "grotesque",
    display: "PT Sans",
    body: "PT Serif",
    dw: 700,
    bw: 400,
    xh: true,
    why: "Superfamily pairing — bold PT Sans with its matching PT Serif body for perfect harmony.",
    use: "Content-heavy sites · Publication · International",
  },
];

const STRATEGIES = [
  {
    id: "all",
    label: "All",
    vibe: "Curated pairs across 7 strategies",
    gradient: T.gradViolet,
  },
  {
    id: "contrast",
    label: "Contrast",
    vibe: "Serif display + sans body — the timeless editorial formula.",
    gradient: T.gradViolet,
  },
  {
    id: "humanist",
    label: "Humanist",
    vibe: "High-impact condensed headlines + readable sans body.",
    gradient: T.gradMagenta,
  },
  {
    id: "mono",
    label: "Mono Accent",
    vibe: "Geometric or sans headline + monospaced body for tech.",
    gradient: T.gradOrange,
  },
  {
    id: "slab",
    label: "Slab Power",
    vibe: "Slab serif display + sans body — journalistic authority.",
    gradient: T.gradCoral,
  },
  {
    id: "serif-serif",
    label: "Serif Stack",
    vibe: "Two serifs — varied optical size and weight. Literary depth.",
    gradient: T.gradViolet,
  },
  {
    id: "display-drama",
    label: "Display Drama",
    vibe: "Condensed/fat display + soft serif body. Cinematic tension.",
    gradient: T.gradMagenta,
  },
  {
    id: "grotesque",
    label: "Grotesque",
    vibe: "Sans + sans — hierarchy through weight alone. Swiss clarity.",
    gradient: T.gradOrange,
  },
];

const PREVIEW_TEXTS = [
  "The quick brown fox",
  "Design is intelligence",
  "Form follows function",
  "Less is more",
  "Grid defines freedom",
  "Type sets the mood",
  "Contrast creates life",
  "Space breathes meaning",
  "Beauty in simplicity",
  "Bold ideas start here",
];

export function makeFontUrl(roles: { name: string; weight: number }[]) {
  const families = new Map<string, Set<number>>();
  for (const r of roles) {
    if (!families.has(r.name)) families.set(r.name, new Set());
    families.get(r.name)!.add(r.weight);
  }
  return (
    "https://fonts.googleapis.com/css2?" +
    [...families]
      .map(
        ([name, weights]) =>
          `family=${encodeURIComponent(name).replace(/%20/g, "+")}:wght@${[...weights].sort((a, b) => a - b).join(";")}`,
      )
      .join("&") +
    "&display=swap"
  );
}

export function FontPairing() {
  const [fontStatus, setFontStatus] = useState("Loading font files…");
  const [strategy, setStrategy] = useStudioDraft("font.strategy", "all");
  const [pairIdx, setPairIdx] = useStudioDraft("font.pairIdx", 0);
  const [customText, setCustomText] = useStudioDraft("font.customText", "");
  const [fontSize, setFontSize] = useStudioDraft("font.fontSize", 54);
  const [history, setHistory] = useStudioDraft("font.history", [
    { strategy: "all", pairIdx: 0 },
  ]);
  const [histIdx, setHistIdx] = useStudioDraft("font.histIdx", 0);

  const pool =
    strategy === "all" ? PAIR_DB : PAIR_DB.filter((p: any) => p.s === strategy);
  const safeIdx = pairIdx % Math.max(pool.length, 1);
  const pair = pool[safeIdx] || PAIR_DB[0];
  const strat = STRATEGIES.find((s) => s.id === strategy) || STRATEGIES[0];
  const previewText =
    customText || PREVIEW_TEXTS[safeIdx % PREVIEW_TEXTS.length];

  useEffect(() => {
    let live = true;
    setFontStatus("Loading font files…");
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = makeFontUrl([
      { name: pair.display, weight: pair.dw },
      { name: pair.body, weight: pair.bw },
    ]);
    const timer = setTimeout(() => {
      if (live)
        setFontStatus("Font loading is slow. Preview may use fallback fonts.");
    }, 10000);
    link.onload = () => {
      void Promise.all([
        document.fonts.load(`${pair.dw} 32px "${pair.display}"`),
        document.fonts.load(`${pair.bw} 16px "${pair.body}"`),
      ])
        .then((faces) => {
          if (live) {
            clearTimeout(timer);
            setFontStatus(
              faces.every((f) => f.length > 0)
                ? "Selected font files loaded."
                : "Some fonts are unavailable; preview uses a fallback.",
            );
          }
        })
        .catch(() => {
          if (live)
            setFontStatus(
              "Font files unavailable; preview uses fallback fonts.",
            );
        });
    };
    link.onerror = () => {
      if (live) {
        clearTimeout(timer);
        setFontStatus("Font files unavailable; preview uses fallback fonts.");
      }
    };
    document.head.appendChild(link);
    return () => {
      live = false;
      clearTimeout(timer);
      link.remove();
    };
  }, [pair.display, pair.body, pair.dw, pair.bw]);

  function pushHistory(s: string, idx: number) {
    const next = [
      ...history.slice(0, histIdx + 1),
      { strategy: s, pairIdx: idx },
    ].slice(-12);
    setHistory(next);
    setHistIdx(next.length - 1);
  }

  function regenerate() {
    const currentPool =
      strategy === "all"
        ? PAIR_DB
        : PAIR_DB.filter((p: any) => p.s === strategy);
    let next = Math.floor(Math.random() * currentPool.length);
    if (currentPool.length > 1 && next === safeIdx)
      next = (next + 1) % currentPool.length;
    setPairIdx(next);
    pushHistory(strategy, next);
  }

  function switchStrategy(s: string) {
    setStrategy(s);
    setPairIdx(0);
    pushHistory(s, 0);
  }

  function goBack() {
    if (histIdx > 0) {
      const prev = history[histIdx - 1];
      setHistIdx(histIdx - 1);
      setStrategy(prev.strategy);
      setPairIdx(prev.pairIdx);
    }
  }
  function goForward() {
    if (histIdx < history.length - 1) {
      const next = history[histIdx + 1];
      setHistIdx(histIdx + 1);
      setStrategy(next.strategy);
      setPairIdx(next.pairIdx);
    }
  }

  const catScore = pair.s !== "grotesque" ? 92 : 65;
  const xhScore = pair.xh ? 96 : 72;
  const wDiff = Math.abs(pair.dw - pair.bw);
  const wScore = wDiff >= 300 ? 90 : wDiff >= 200 ? 78 : 62;

  const currentPool =
    strategy === "all" ? PAIR_DB : PAIR_DB.filter((p: any) => p.s === strategy);

  return (
    <div style={{ display: "flex", gap: 24, flexDirection: "column" }}>
      <div
        style={{
          display: "flex",
          gap: 10,
          alignItems: "center",
          flexWrap: "wrap",
        }}
      >
        <div
          style={{
            display: "flex",
            gap: 6,
            flexWrap: "nowrap",
            flex: 1,
            overflowX: "auto",
            scrollbarWidth: "none",
          }}
        >
          {STRATEGIES.map((s) => (
            <button
              key={s.id}
              aria-pressed={strategy === s.id}
              onClick={() => switchStrategy(s.id)}
              style={{
                padding: "6px 14px",
                borderRadius: "var(--radius-pill)",
                border: "none",
                cursor: "pointer",
                fontFamily: "var(--font-body)",
                fontSize: 12,
                fontWeight: strategy === s.id ? 500 : 400,
                background:
                  strategy === s.id
                    ? "var(--color-inverse-canvas)"
                    : "var(--color-surface-1)",
                color:
                  strategy === s.id
                    ? "var(--color-canvas)"
                    : "var(--color-ink-muted)",
                whiteSpace: "nowrap",
                transition: "all .12s",
              }}
            >
              {s.label}
              {s.id !== "all" && (
                <span style={{ marginLeft: 6, fontSize: 10, opacity: 0.6 }}>
                  {PAIR_DB.filter((p: any) => p.s === s.id).length}
                </span>
              )}
            </button>
          ))}
        </div>
        <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
          <button
            aria-label="Previous font pairing"
            onClick={goBack}
            disabled={histIdx === 0}
            style={{
              ...ss.btnSec,
              padding: "10px 14px",
              opacity: histIdx === 0 ? 0.3 : 1,
            }}
          >
            ←
          </button>
          <button
            aria-label="Next font pairing"
            onClick={goForward}
            disabled={histIdx === history.length - 1}
            style={{
              ...ss.btnSec,
              padding: "10px 14px",
              opacity: histIdx === history.length - 1 ? 0.3 : 1,
            }}
          >
            →
          </button>
          <button
            onClick={regenerate}
            style={{
              ...ss.btnPri,
              display: "flex",
              alignItems: "center",
              gap: 8,
            }}
          >
            <span style={{ fontSize: 15, lineHeight: 1 }}>↺</span>
            Regenerate
          </button>
        </div>
      </div>

      <div
        role="status"
        style={{
          fontFamily: "var(--font-body)",
          fontSize: 13,
          color: "var(--color-ink-muted)",
          marginBottom: 16,
        }}
      >
        {fontStatus} · Showing pair {safeIdx + 1} of {currentPool.length} in{" "}
        <span style={{ color: T.inkMuted }}>{strat.label}</span>
      </div>

      <div
        style={{
          background: "var(--color-surface-1)",
          borderRadius: "var(--radius-xl)",
          padding: 40,
          border: `1px solid ${T.hairlineSoft}`,
          position: "relative",
          overflow: "hidden",
          minHeight: 260,
        }}
      >
        <div
          style={{
            position: "absolute",
            top: -80,
            right: -80,
            width: 280,
            height: 280,
            borderRadius: "50%",
            background: strat.gradient,
            opacity: 0.13,
            filter: "blur(70px)",
            pointerEvents: "none",
          }}
        />
        <div
          style={{
            display: "flex",
            gap: 7,
            marginBottom: 22,
            flexWrap: "wrap",
          }}
        >
          <span
            style={{
              padding: "4px 10px",
              borderRadius: 6,
              background: T.surface2,
              color: T.inkMuted,
              fontFamily: "var(--font-body)",
              fontSize: 11,
              fontWeight: 500,
            }}
          >
            {strat.label}
          </span>
          <span
            style={{
              padding: "4px 10px",
              borderRadius: 6,
              background: T.surface2,
              color: T.inkMuted,
              fontFamily: "var(--font-body)",
              fontSize: 11,
            }}
          >
            {pair.xh
              ? "Curator: related proportions"
              : "Curator: contrasting proportions"}
          </span>
          <span
            style={{
              padding: "4px 10px",
              borderRadius: 6,
              background: T.surface2,
              color: T.inkMuted,
              fontFamily: "var(--font-body)",
              fontSize: 11,
            }}
          >
            Δ weight {Math.abs(pair.dw - pair.bw)}
          </span>
        </div>

        <div
          style={{
            fontFamily: `'${pair.display}',serif,sans-serif`,
            fontWeight: pair.dw,
            fontSize: fontSize,
            letterSpacing: fontSize > 52 ? "-2px" : "-0.5px",
            lineHeight: 0.95,
            color: T.ink,
            marginBottom: 20,
            wordBreak: "break-word",
          }}
        >
          {previewText}
        </div>

        <div style={{ height: 1, background: T.hairline, marginBottom: 20 }} />

        <p
          style={{
            fontFamily: `'${pair.body}',sans-serif,serif`,
            fontWeight: pair.bw,
            fontSize: 16,
            lineHeight: 1.65,
            color: T.inkMuted,
            letterSpacing: "-0.16px",
            margin: 0,
            maxWidth: 580,
          }}
        >
          {pair.why} — Body specimen in{" "}
          <strong style={{ color: T.ink, fontWeight: 600 }}>{pair.body}</strong>{" "}
          at 16px.
        </p>
        <p
          style={{
            fontFamily: `'${pair.body}',sans-serif,serif`,
            fontWeight: pair.bw,
            fontSize: 13,
            lineHeight: 1.5,
            color: T.inkDim,
            letterSpacing: "-0.13px",
            margin: "8px 0 0",
          }}
        >
          Best for: {pair.use}
        </p>

        <div
          style={{ display: "flex", gap: 10, marginTop: 24, flexWrap: "wrap" }}
        >
          {[
            { label: "Display", name: pair.display, w: pair.dw },
            { label: "Body", name: pair.body, w: pair.bw },
          ].map((f: any) => (
            <div
              key={f.label}
              style={{
                background: "var(--color-surface-1)",
                borderRadius: "var(--radius-xl)",
                padding: "16px",
                border: `1px solid ${T.hairlineSoft}`,
                flex: 1,
                minWidth: 120,
              }}
            >
              <div
                style={{
                  fontFamily: "var(--font-body)",
                  fontSize: 10,
                  color: T.inkMuted,
                  letterSpacing: ".06em",
                  textTransform: "uppercase",
                  marginBottom: 4,
                }}
              >
                {f.label}
              </div>
              <div
                style={{
                  fontFamily: `'${f.name}',serif,sans-serif`,
                  fontWeight: f.w,
                  fontSize: 16,
                  color: T.ink,
                  marginBottom: 2,
                }}
              >
                {f.name}
              </div>
              <div
                style={{
                  fontFamily: "var(--font-body)",
                  fontSize: 10,
                  color: T.inkDim,
                }}
              >
                weight {f.w}
              </div>
            </div>
          ))}
          <p className="studio-help">
            Curated pairing suggestion. Proportions and usage notes are
            editorial judgments, not measured font-quality scores.
          </p>
        </div>
      </div>

      <div
        style={{
          display: "flex",
          gap: 16,
          flexWrap: "wrap",
          alignItems: "center",
        }}
      >
        <div style={{ flex: 1, minWidth: 200 }}>
          <label style={ss.label} htmlFor="font-preview">
            Preview text
          </label>
          <input
            id="font-preview"
            value={customText}
            onChange={(e: any) => setCustomText(e.target.value)}
            style={ss.input}
            placeholder={previewText}
          />
        </div>
        <div style={{ width: 160 }}>
          <label htmlFor="font-size" style={ss.label}>
            Display size — {fontSize}px
          </label>
          <input
            id="font-size"
            type="range"
            min={24}
            max={96}
            value={fontSize}
            onChange={(e: any) => setFontSize(+e.target.value)}
            style={{ width: "100%", accentColor: T.accentBlue }}
          />
        </div>
        <a
          href={`https://fonts.google.com/specimen/${encodeURIComponent(pair.display)}`}
          target="_blank"
          rel="noopener"
          style={{
            ...ss.btnSec,
            textDecoration: "none",
            whiteSpace: "nowrap",
            fontSize: 12,
          }}
        >
          ↗ {pair.display}
        </a>
        <a
          href={`https://fonts.google.com/specimen/${encodeURIComponent(pair.body)}`}
          target="_blank"
          rel="noopener"
          style={{
            ...ss.btnSec,
            textDecoration: "none",
            whiteSpace: "nowrap",
            fontSize: 12,
          }}
        >
          ↗ {pair.body}
        </a>
      </div>

      <div
        style={{
          display: "flex",
          gap: 5,
          alignItems: "center",
          paddingTop: 4,
          flexWrap: "wrap",
        }}
      >
        <span
          style={{
            fontFamily: "var(--font-body)",
            fontSize: 11,
            color: T.inkDim,
          }}
        >
          History:
        </span>
        {history.map((h: any, i: number) => (
          <button
            aria-label={`Restore pairing ${i + 1}`}
            aria-pressed={i === histIdx}
            key={i}
            onClick={() => {
              setHistIdx(i);
              setStrategy(h.strategy);
              setPairIdx(h.pairIdx);
            }}
            style={{
              width: 28,
              height: 28,
              borderRadius: "50%",
              border: "none",
              cursor: "pointer",
              background:
                i === histIdx
                  ? "var(--color-inverse-canvas)"
                  : "var(--color-surface-2)",
              padding: 0,
              transition: "background .15s",
            }}
          />
        ))}
        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 10,
            color: T.inkDim,
            marginLeft: 6,
          }}
        >
          {pair.display} + {pair.body}
        </span>
      </div>
    </div>
  );
}
