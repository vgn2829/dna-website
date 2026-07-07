import { useState, useRef, useEffect } from "react";
import { useLocation, useSearchParams } from "react-router";
import PaletteStudio from "../components/PaletteStudio";
import { HalftoneStudio } from "../components/HalftoneStudio";
import { SvgConverter } from "../components/SvgConverter";

const T = {
  get canvas()       { return "var(--color-canvas)"; },
  get surface1()     { return "var(--color-surface-1)"; },
  get surface2()     { return "var(--color-surface-2)"; },
  get surface3()     { return "var(--color-surface-2)"; },
  get hairline()     { return "var(--color-hairline)"; },
  get hairlineSoft() { return "var(--color-hairline-soft)"; },
  get ink()          { return "var(--color-ink)"; },
  get inkMuted()     { return "var(--color-ink-muted)"; },
  get inkDim()       { return "var(--color-ink-muted)"; },
  get accentBlue()   { return "var(--color-accent-blue)"; },
  get primary()      { return "var(--color-inverse-canvas)"; },
  get gradViolet()   { return "var(--gradient-violet)"; },
  get gradMagenta()  { return "var(--gradient-magenta)"; },
  get gradOrange()   { return "var(--gradient-orange)"; },
  get gradCoral()    { return "var(--gradient-coral)"; },
};

const ss: any = {
  label: {
    display: "block",
    fontFamily: "var(--font-body)",
    fontSize: 11,
    color: "var(--color-ink-muted)",
    letterSpacing: "0.06em",
    textTransform: "uppercase" as const,
    marginBottom: 7,
  },
  input: {
    width: "100%",
    padding: "9px 13px",
    borderRadius: "var(--radius-md)",
    background: "var(--color-surface-2)",
    border: "1px solid var(--color-hairline)",
    color: "var(--color-ink)",
    fontFamily: "var(--font-body)",
    fontSize: 14,
    outline: "none",
    boxSizing: "border-box" as const,
  },
  btnPri: {
    padding: "10px 18px",
    borderRadius: "var(--radius-pill)",
    border: "none",
    cursor: "pointer",
    background: "var(--color-inverse-canvas)",
    color: "var(--color-canvas)",
    fontFamily: "var(--font-body)",
    fontSize: 13,
    fontWeight: 500,
    letterSpacing: "-0.13px",
  },
  btnSec: {
    padding: "10px 18px",
    borderRadius: "var(--radius-pill)",
    border: "none",
    cursor: "pointer",
    background: "var(--color-surface-2)",
    color: "var(--color-ink)",
    fontFamily: "var(--font-body)",
    fontSize: 13,
    fontWeight: 500,
    letterSpacing: "-0.13px",
  },
};

const PAIR_DB: any[] = [
  // ── CONTRAST: serif display + sans body ──
  { s:"contrast", display:"Playfair Display",   body:"Source Sans 3",    dw:700, bw:400, xh:true,  why:"High stroke contrast meets open grotesque body.", use:"Magazine · Luxury · Editorial" },
  { s:"contrast", display:"Playfair Display",   body:"Inter",            dw:700, bw:400, xh:true,  why:"Elegant display, neutral system body — maximally readable.", use:"Blog · Portfolio · SaaS" },
  { s:"contrast", display:"Cormorant Garamond", body:"Proza Libre",      dw:600, bw:400, xh:false, why:"Delicate Garamond with a generous, open body face.", use:"Fashion · Heritage · Publishing" },
  { s:"contrast", display:"Cormorant Garamond", body:"DM Sans",          dw:700, bw:400, xh:true,  why:"Aristocratic display, clean modern body.", use:"Luxury · High-end editorial" },
  { s:"contrast", display:"Lora",               body:"Nunito",           dw:700, bw:400, xh:true,  why:"Warm bracketed serifs + rounded humanist sans.", use:"Lifestyle · Wellness · Food blog" },
  { s:"contrast", display:"Merriweather",       body:"Open Sans",        dw:700, bw:400, xh:true,  why:"Google's own flagship editorial pairing.", use:"News · Documentation · Reports" },
  { s:"contrast", display:"EB Garamond",        body:"Lato",             dw:700, bw:300, xh:false, why:"Renaissance warmth + 20th century geometric cool.", use:"Academic · Long-form · Heritage" },
  { s:"contrast", display:"Libre Baskerville",  body:"Libre Franklin",   dw:700, bw:400, xh:true,  why:"Sibling fonts from the same designer — perfect harmony.", use:"Journalism · Government · Editorial" },
  { s:"contrast", display:"DM Serif Display",   body:"DM Sans",          dw:400, bw:400, xh:true,  why:"Same type family — designer-matched display/body pair.", use:"Product · Marketing · Web app" },
  { s:"contrast", display:"Fraunces",           body:"Inter",            dw:700, bw:400, xh:true,  why:"Optical size serif designed for headlines + neutral body.", use:"Poster · Branding · Web" },
  { s:"contrast", display:"Spectral",           body:"Source Sans 3",    dw:700, bw:400, xh:true,  why:"Book-grade serif display against clean sans body.", use:"Publishing · Long-form · Literary" },
  { s:"contrast", display:"Crimson Pro",        body:"Work Sans",        dw:700, bw:400, xh:true,  why:"Scholarly display meets utilitarian sans.", use:"Research · Nonprofit · Editorial" },
  { s:"contrast", display:"Tenor Sans",         body:"Raleway",          dw:400, bw:300, xh:true,  why:"Two light, airy typefaces — elegant, fashion-forward.", use:"Fashion · Lifestyle · Minimal" },

  // ── HUMANIST: condensed headline + sans body ──
  { s:"humanist", display:"Oswald",             body:"Hind",             dw:600, bw:400, xh:true,  why:"Classic web pairing — condensed headlines, Indian-influenced body.", use:"News · Sports · Web" },
  { s:"humanist", display:"Oswald",             body:"Source Sans 3",    dw:600, bw:400, xh:true,  why:"Condensed display, versatile humanist body.", use:"Poster · Sports · Editorial" },
  { s:"humanist", display:"Barlow Condensed",   body:"Barlow",           dw:700, bw:400, xh:true,  why:"Same family — condensed + regular is a designer-approved cheat code.", use:"Brand · Presentation · Web" },
  { s:"humanist", display:"Josefin Sans",       body:"Josefin Slab",     dw:700, bw:300, xh:false, why:"Geometric pair from the same designer — rare matching elegance.", use:"Fashion · Minimal · Poster" },
  { s:"humanist", display:"Raleway",            body:"Raleway",          dw:800, bw:300, xh:true,  why:"One family, radical weight contrast. Weight IS the hierarchy.", use:"Landing page · Portfolio · Minimal" },
  { s:"humanist", display:"Fjalla One",         body:"Cantarell",        dw:400, bw:400, xh:true,  why:"Heavy condensed + GNOME's clean humanist body.", use:"Tech · App · Linux-adjacent" },
  { s:"humanist", display:"Bebas Neue",         body:"Roboto",           dw:400, bw:400, xh:false, why:"Street-level poster display + Google's workhorse body.", use:"Streetwear · Gym · Poster" },
  { s:"humanist", display:"Bebas Neue",         body:"Open Sans",        dw:400, bw:400, xh:false, why:"All-caps drama + the most web-safe body font alive.", use:"Event · Brand · Digital" },
  { s:"humanist", display:"Anton",              body:"Roboto",           dw:400, bw:300, xh:false, why:"Extreme weight contrast — attention-grabbing poster energy.", use:"Sports · Entertainment · Promo" },
  { s:"humanist", display:"Righteous",          body:"Nunito",           dw:400, bw:400, xh:true,  why:"Retro display + rounded friendly body.", use:"Games · Kids · Fun brand" },
  { s:"humanist", display:"Russo One",          body:"Roboto",           dw:400, bw:400, xh:true,  why:"Boxy, technical display + clean neutral body.", use:"Tech · Gaming · App" },
  { s:"humanist", display:"Pathway Gothic One", body:"Source Sans 3",    dw:400, bw:400, xh:true,  why:"Extremely condensed newsprint display + open body.", use:"News · Politics · Event" },

  // ── MONO ACCENT ──
  { s:"mono", display:"Space Grotesk",       body:"Space Mono",       dw:600, bw:400, xh:true,  why:"Space family pair — designed to work together. Technical poetry.", use:"Dev tools · Code blog · Tech brand" },
  { s:"mono", display:"IBM Plex Sans",       body:"IBM Plex Mono",    dw:600, bw:400, xh:true,  why:"IBM's own system — the gold standard of corporate type families.", use:"Enterprise · SaaS · Documentation" },
  { s:"mono", display:"Manrope",             body:"DM Mono",          dw:700, bw:400, xh:true,  why:"Friendly geometric + clean monospaced body.", use:"Startup · Dev product · Technical" },
  { s:"mono", display:"Inter",               body:"JetBrains Mono",   dw:600, bw:400, xh:true,  why:"The definitive developer UI pairing.", use:"IDE · Dev tool · Code documentation" },
  { s:"mono", display:"Outfit",              body:"Roboto Mono",      dw:600, bw:400, xh:true,  why:"Modern geometric display + Google's monospaced body.", use:"Tech startup · SaaS dashboard" },
  { s:"mono", display:"Exo 2",              body:"Share Tech Mono",   dw:700, bw:400, xh:true,  why:"Sci-fi geometric display + technical monospaced body.", use:"Gaming · Sci-fi · Tech" },
  { s:"mono", display:"Rajdhani",            body:"Source Code Pro",  dw:600, bw:400, xh:true,  why:"Devanagari-influenced display + code body — unique, memorable.", use:"Data product · Terminal · Dev" },

  // ── SLAB POWER ──
  { s:"slab", display:"Arvo",               body:"Lato",             dw:700, bw:400, xh:false, why:"Geometric slab + humanist sans — balanced journalistic pair.", use:"News · Blog · Editorial" },
  { s:"slab", display:"Rokkitt",            body:"Open Sans",        dw:700, bw:400, xh:true,  why:"Slab headline energy with highly legible body.", use:"Marketing · Presentation · Web" },
  { s:"slab", display:"Zilla Slab",         body:"Fira Sans",        dw:700, bw:400, xh:true,  why:"Mozilla's own pair — clean slab + humanist body.", use:"Firefox · Open source · Brand" },
  { s:"slab", display:"Bitter",             body:"Raleway",          dw:700, bw:300, xh:true,  why:"News slab + editorial geometric — confident and clean.", use:"Magazine · News · Blog" },
  { s:"slab", display:"Crete Round",        body:"Nunito Sans",      dw:400, bw:400, xh:false, why:"Soft slab curves pair with Nunito's round friendly feel.", use:"Food · Lifestyle · Friendly brand" },
  { s:"slab", display:"Alfa Slab One",      body:"Source Sans 3",    dw:400, bw:400, xh:false, why:"Maximum slab weight + neutral open body.", use:"Sports · Entertainment · Bold brand" },
  { s:"slab", display:"Roboto Slab",        body:"Roboto",           dw:700, bw:400, xh:true,  why:"The Google-matched slab/sans pair. Practically foolproof.", use:"Product · Documentation · App" },
  { s:"slab", display:"Rockwell",           body:"Gill Sans",        dw:700, bw:400, xh:true,  why:"Classic slab + classic humanist — British editorial tradition.", use:"Heritage · Print · Formal" },

  // ── SERIF STACK ──
  { s:"serif-serif", display:"Playfair Display",   body:"Lora",          dw:700, bw:400, xh:true,  why:"Both transitional serifs — different optical sizes, same spirit.", use:"Literary · Blog · Publishing" },
  { s:"serif-serif", display:"Cormorant Garamond", body:"EB Garamond",   dw:700, bw:400, xh:false, why:"Two Garamonds — one display-cut, one text-cut. Sophisticated layering.", use:"Academic · Heritage · Luxury" },
  { s:"serif-serif", display:"Abril Fatface",      body:"Lora",          dw:400, bw:400, xh:false, why:"Fat display serif + refined text serif — editorial magazine feel.", use:"Magazine · Fashion · Culture" },
  { s:"serif-serif", display:"Rufina",             body:"Libre Baskerville",dw:700,bw:400,xh:false, why:"Decorative serif display + sturdy text serif body.", use:"Artisan · Print · Brand" },
  { s:"serif-serif", display:"DM Serif Display",   body:"Lora",          dw:400, bw:400, xh:true,  why:"Optical display cut + high-quality text cut — matched x-height.", use:"Editorial · Web magazine" },
  { s:"serif-serif", display:"Fraunces",           body:"Crimson Pro",   dw:700, bw:400, xh:false, why:"Variable optical size display + elegant text serif.", use:"Literary · Publishing · Culture" },
  { s:"serif-serif", display:"Playfair Display",   body:"PT Serif",      dw:700, bw:400, xh:true,  why:"Elegant display + versatile Cyrillic-origin text serif.", use:"International editorial · Long-form" },
  { s:"serif-serif", display:"Libre Caslon Display",body:"Libre Caslon Text",dw:400,bw:400,xh:true,why:"Display/text cut siblings from the Caslon revival. Purist.", use:"Publishing · Heritage · Long-form" },

  // ── DISPLAY DRAMA ──
  { s:"display-drama", display:"Oswald",           body:"Merriweather",   dw:700, bw:300, xh:true,  why:"Condensed power + warm bracketed serif body.", use:"News · Editorial · Magazine" },
  { s:"display-drama", display:"Bebas Neue",       body:"Libre Baskerville",dw:400,bw:400,xh:false, why:"All-caps tension + literary body serif.", use:"Film · Poster · Dramatic brand" },
  { s:"display-drama", display:"Barlow Condensed", body:"Lora",           dw:700, bw:400, xh:true,  why:"Tight condensed headline over warm text serif.", use:"Magazine · Feature article" },
  { s:"display-drama", display:"Fjalla One",       body:"Merriweather",   dw:400, bw:300, xh:false, why:"Heavy condensed + Georgia-class serif body.", use:"News · Nonprofit · Editorial" },
  { s:"display-drama", display:"Abril Fatface",    body:"Crimson Text",   dw:400, bw:400, xh:false, why:"Ultra-fat display + elegant text serif — magazine front pages.", use:"Culture · Lifestyle · Magazine" },
  { s:"display-drama", display:"Anton",            body:"Playfair Display",dw:400, bw:400, xh:false, why:"Brutal weight followed by elegant serif body — theatrical.", use:"Film · Event · Dramatic poster" },
  { s:"display-drama", display:"Righteous",        body:"Lora",           dw:400, bw:400, xh:false, why:"Retro display + editorial serif body.", use:"Retro brand · Magazine · Culture" },
  { s:"display-drama", display:"Teko",             body:"Hind",           dw:600, bw:400, xh:true,  why:"Devanagari-inspired condensed display + Indic humanist body.", use:"South Asian · Publishing · Brand" },

  // ── GROTESQUE ──
  { s:"grotesque", display:"Inter",              body:"Inter",            dw:800, bw:400, xh:true,  why:"One font, weight is the only tool. Swiss clarity.", use:"Product · Dashboard · App" },
  { s:"grotesque", display:"Manrope",            body:"Manrope",          dw:800, bw:300, xh:true,  why:"Variable font — 800 vs 300 = dramatic hierarchy from one typeface.", use:"SaaS · Landing page · Minimal" },
  { s:"grotesque", display:"Space Grotesk",      body:"DM Sans",          dw:700, bw:400, xh:true,  why:"Two modern grotesques — slightly different personalities, same modernist DNA.", use:"Tech · Startup · Product" },
  { s:"grotesque", display:"Plus Jakarta Sans",  body:"Inter",            dw:700, bw:400, xh:true,  why:"Warm geometric headline + neutral system body.", use:"Startup · App · Web" },
  { s:"grotesque", display:"Outfit",             body:"Nunito",           dw:700, bw:400, xh:true,  why:"Friendly geometric pair — both rounded, both warm.", use:"Consumer · Lifestyle · App" },
  { s:"grotesque", display:"Nunito",             body:"Nunito",           dw:800, bw:300, xh:true,  why:"Variable weight contrast within one rounded typeface.", use:"Kids · Education · Friendly" },
  { s:"grotesque", display:"Jost",               body:"DM Sans",          dw:700, bw:400, xh:true,  why:"Futura-like geometric + contemporary DM Sans.", use:"Brand · Minimal · Future" },
  { s:"grotesque", display:"Urbanist",           body:"Inter",            dw:700, bw:400, xh:true,  why:"Urban geometric display + reliable Inter body.", use:"Urban · Real estate · Product" },
  { s:"grotesque", display:"Lexend",             body:"Noto Sans",        dw:700, bw:400, xh:true,  why:"Accessibility-optimized pair — wide-aperture fonts for readability.", use:"Education · Accessibility · Healthcare" },
  { s:"grotesque", display:"Work Sans",          body:"Work Sans",        dw:700, bw:300, xh:true,  why:"Variable grotesque — pure weight contrast within one family.", use:"Agency · Portfolio · Professional" },

  // ── NEW PAIRS ──
  { s:"contrast", display:"Quattrocento",        body:"Quattrocento Sans",  dw:700, bw:400, xh:true,  why:"Sibling pair from same designer — serif display with matching sans body.", use:"Classic · Formal · Elegant" },
  { s:"contrast", display:"Noto Serif",          body:"Inter",              dw:700, bw:400, xh:true,  why:"Google's own global-first pair — maximum language coverage.", use:"International · Multilingual · Editorial" },
  { s:"contrast", display:"Prata",               body:"Red Hat Text",       dw:400, bw:400, xh:true,  why:"High-contrast display serif + clean technical sans body.", use:"Brand · Luxury · Product" },
  { s:"contrast", display:"Instrument Serif",    body:"Instrument Sans",    dw:400, bw:400, xh:true,  why:"Figma's own family — display and sans cut from the same DNA.", use:"Design tools · Product · Web app" },
  { s:"contrast", display:"Eczar",               body:"Libre Franklin",     dw:700, bw:400, xh:true,  why:"Devanagari-inspired display serif + American grotesque body.", use:"Multilingual · Editorial · Brand" },
  { s:"contrast", display:"Marcellus",           body:"DM Sans",            dw:400, bw:400, xh:false, why:"Lapidary Roman display + contemporary geometric body — understated elegance.", use:"Luxury · Portfolio · Architecture" },
  { s:"contrast", display:"Lora",                body:"Open Sans",          dw:700, bw:400, xh:true,  why:"Warm contemporary serif + Google's most-used sans body.", use:"Blog · E-commerce · Marketing" },
  { s:"contrast", display:"Playfair Display",    body:"Raleway",            dw:700, bw:300, xh:false, why:"Classic editorial display + elegant thin sans body — fashion-editorial.", use:"Fashion · Luxury · Lifestyle blog" },
  { s:"contrast", display:"Cormorant Garamond",  body:"Raleway",            dw:600, bw:300, xh:false, why:"Refined Garamond + thin geometric sans — haute-couture feeling.", use:"Fashion · Bridal · High-end" },
  { s:"contrast", display:"Fraunces",            body:"Epilogue",           dw:700, bw:400, xh:true,  why:"Variable optical serif + crisp neutral grotesque body.", use:"Startup · Creative · Web" },
  { s:"contrast", display:"Lora",                body:"Montserrat",         dw:700, bw:400, xh:true,  why:"Warm serif + geometric urban sans — approachable editorial.", use:"Blog · Small business · Marketing" },
  { s:"contrast", display:"Playfair Display",    body:"Lato",               dw:700, bw:300, xh:false, why:"Traditional display charm + modern humanist clarity.", use:"Magazine · Lifestyle · Creative" },
  { s:"contrast", display:"Libre Baskerville",   body:"Montserrat",         dw:700, bw:400, xh:true,  why:"Sturdy text serif + geometric grotesque — clean and authoritative.", use:"Business · Nonprofit · Editorial" },
  { s:"contrast", display:"Merriweather",        body:"Lato",               dw:700, bw:300, xh:true,  why:"Readability-optimized serif + light humanist body.", use:"Blog · Documentation · News" },
  { s:"contrast", display:"Montagu Slab",        body:"Figtree",            dw:700, bw:400, xh:true,  why:"Contemporary optical slab + friendly rounded sans.", use:"Brand · Product · Lifestyle" },
  { s:"contrast", display:"Prata",               body:"Manrope",            dw:400, bw:400, xh:false, why:"Display-weight serif + clean geometric body — confident brand voice.", use:"Luxury · Brand · Portfolio" },
  { s:"contrast", display:"Unica One",           body:"Crimson Text",       dw:400, bw:400, xh:false, why:"Geometric condensed display meets warm humanist text serif.", use:"Editorial · Literary · Art direction" },
  { s:"contrast", display:"Cinzel",              body:"Fauna One",          dw:400, bw:400, xh:false, why:"Roman lapidary capitals with a soft organic text body — classical gravitas.", use:"Luxury · Wedding · Heritage brands" },
  { s:"contrast", display:"Yeseva One",          body:"Josefin Sans",       dw:400, bw:300, xh:false, why:"Feminine serif display with a geometric art-deco body — refined contrast.", use:"Fashion · Lifestyle · Creative studio" },
  { s:"contrast", display:"League Spartan",      body:"Libre Baskerville",  dw:700, bw:400, xh:true,  why:"Geometric strength meets serif elegance — bold sans with refined text body.", use:"Corporate · Portfolio · Professional" },
  { s:"contrast", display:"Chonburi",            body:"Domine",             dw:400, bw:400, xh:false, why:"Thai-influenced display with a sturdy news serif body — distinctive and readable.", use:"Editorial · Cultural · Multilingual" },

  { s:"humanist", display:"Rubik",               body:"Open Sans",          dw:700, bw:400, xh:true,  why:"Slightly rounded grotesque + the most neutral open body.", use:"Food · Lifestyle · Friendly web" },
  { s:"humanist", display:"Montserrat",          body:"Open Sans",          dw:700, bw:400, xh:true,  why:"The most popular Google pairing — urban geometric meets open humanist.", use:"Business · Marketing · Landing page" },
  { s:"humanist", display:"Montserrat",          body:"Roboto",             dw:700, bw:400, xh:true,  why:"Buenos Aires geometry + Google's universal body — clean and modern.", use:"App · SaaS · Brand" },
  { s:"humanist", display:"Montserrat",          body:"Raleway",            dw:900, bw:300, xh:true,  why:"Maximum weight Montserrat Black + Raleway thin — extreme contrast.", use:"Landing page · Poster · Minimal" },
  { s:"humanist", display:"Bebas Neue",          body:"Heebo",              dw:400, bw:300, xh:false, why:"All-caps condensed drama + light Hebrew-origin humanist body.", use:"Gym · Sports · Event" },
  { s:"humanist", display:"Oswald",              body:"Roboto",             dw:600, bw:400, xh:true,  why:"Reliable condensed pair — both Google-native, both widely used.", use:"News · Product · Documentation" },
  { s:"humanist", display:"Epilogue",            body:"Barlow",             dw:700, bw:400, xh:true,  why:"Display-weight grotesque + low-contrast humanist body — calm and modern.", use:"SaaS · Agency · Web" },
  { s:"humanist", display:"Syncopate",           body:"Roboto Serif",       dw:700, bw:400, xh:false, why:"All-caps geometric display + Roboto's serif variant — graphic and modern.", use:"Brand · Poster · Architecture" },
  { s:"humanist", display:"Syne",                body:"Syne",               dw:800, bw:400, xh:true,  why:"Variable grotesque family — display and text weights from one typeface.", use:"Agency · Creative · Portfolio" },
  { s:"humanist", display:"Bricolage Grotesque", body:"Manrope",            dw:700, bw:400, xh:true,  why:"Variable display grotesque + clean geometric body — contemporary.", use:"Agency · Tech · Creative" },
  { s:"humanist", display:"Albert Sans",         body:"Barlow",             dw:700, bw:400, xh:true,  why:"Low-contrast neo-grotesque + humanist Barlow — calm, professional.", use:"Corporate · SaaS · Product" },
  { s:"humanist", display:"Corben",              body:"Montserrat",         dw:700, bw:400, xh:false, why:"Quirky display + versatile geometric body — fun and distinct.", use:"Food · Retail · Creative brand" },
  { s:"humanist", display:"Phudu",               body:"Onest",              dw:700, bw:400, xh:true,  why:"Contemporary display grotesque + versatile humanist body.", use:"Tech · Product · Modern web" },
  { s:"humanist", display:"Fugaz One",           body:"Work Sans",          dw:400, bw:400, xh:false, why:"Condensed display energy + utilitarian grotesque body — impact and clarity.", use:"Sports · Event · Bold brand" },
  { s:"humanist", display:"Oswald",              body:"Source Serif 4",     dw:600, bw:400, xh:true,  why:"Condensed sans headline over Google's variable text serif — editorial authority.", use:"News · Magazine · Feature article" },
  { s:"humanist", display:"Sacramento",          body:"Poppins",            dw:400, bw:400, xh:false, why:"Script elegance balanced by a modern geometric sans body — playful and refined.", use:"Lifestyle blog · Boutique · Creative business" },
  { s:"humanist", display:"Sacramento",          body:"Lato",               dw:400, bw:300, xh:false, why:"Flowing script display with a humanist light body — delicate and approachable.", use:"Wedding · Beauty · Artisan brand" },
  { s:"humanist", display:"Grand Hotel",         body:"Lato",               dw:400, bw:300, xh:false, why:"Ornate script display with a clean light humanist body — glamour meets clarity.", use:"Luxury · Hospitality · Event" },
  { s:"humanist", display:"Arima Madurai",       body:"Mulish",             dw:700, bw:400, xh:true,  why:"Rounded display with Devanagari warmth + clean geometric sans body — friendly and global.", use:"Education · Multilingual · Friendly brand" },

  { s:"mono", display:"Syne",               body:"Space Mono",         dw:800, bw:400, xh:true,  why:"Bold variable grotesque + monospaced body — creative studio energy.", use:"Studio · Portfolio · Creative tech" },
  { s:"mono", display:"Space Grotesk",      body:"IBM Plex Mono",      dw:700, bw:400, xh:true,  why:"Retro-tech display + IBM's corporate monospaced — systematic.", use:"Enterprise tech · Data · SaaS" },
  { s:"mono", display:"Bricolage Grotesque",body:"DM Mono",            dw:700, bw:400, xh:true,  why:"Contemporary display + clean mono body — developer product feel.", use:"Dev tool · API docs · Tech brand" },
  { s:"mono", display:"Space Mono",        body:"Plus Jakarta Sans",  dw:700, bw:400, xh:true,  why:"Retro monospaced display + contemporary geometric sans body — technical meets modern.", use:"Dev tool · Portfolio · Creative tech" },

  { s:"slab", display:"Roboto Slab",        body:"Lato",               dw:700, bw:300, xh:true,  why:"Google slab family + lightweight humanist body — authoritative yet approachable.", use:"Business · Blog · Report" },
  { s:"slab", display:"Bitter",             body:"Open Sans",          dw:700, bw:400, xh:true,  why:"News-grade slab + the web's most-used sans — journalistic powerhouse.", use:"News · Content marketing · Blog" },
  { s:"slab", display:"Arvo",               body:"Open Sans",          dw:700, bw:400, xh:false, why:"Geometric slab display + open humanist body — structural and clear.", use:"Design system · Product · Web" },
  { s:"slab", display:"Zilla Slab",         body:"Source Sans 3",      dw:700, bw:400, xh:true,  why:"Mozilla's slab + versatile Source sans — trusted, readable pair.", use:"Tech brand · Documentation · Blog" },
  { s:"slab", display:"Lexend",             body:"Zilla Slab",         dw:700, bw:400, xh:true,  why:"Accessibility display + slab body — highly legible, educational.", use:"E-learning · Healthcare · Accessibility" },
  { s:"slab", display:"Work Sans",          body:"Bitter",             dw:700, bw:400, xh:true,  why:"Sans headline + slab body — inverts convention for editorial richness.", use:"Magazine · Blog · Editorial" },
  { s:"slab", display:"Montagu Slab",       body:"Source Sans 3",      dw:700, bw:400, xh:true,  why:"Modern optical slab + versatile sans body — design-system ready.", use:"Product · Brand · Web" },
  { s:"slab", display:"Ultra",              body:"Slabo 27px",         dw:400, bw:400, xh:false, why:"Maximum-weight slab display + a text-optimized serif body — extreme editorial contrast.", use:"Poster · Magazine · Bold editorial" },

  { s:"serif-serif", display:"Quattrocento",     body:"Fanwood Text",       dw:700, bw:400, xh:false, why:"Classical Italian roman + American text serif — old-world literary.", use:"Academic · Heritage · Publishing" },
  { s:"serif-serif", display:"Abril Fatface",    body:"Crimson Pro",        dw:400, bw:400, xh:false, why:"Ultra-fat display + refined scholarly text serif.", use:"Culture · Literary · Magazine" },
  { s:"serif-serif", display:"Lora",             body:"Crimson Pro",        dw:700, bw:400, xh:true,  why:"Contemporary text serif + elegant old-style body — layered warmth.", use:"Literary · Blog · Publishing" },
  { s:"serif-serif", display:"Playfair Display", body:"Merriweather",       dw:700, bw:300, xh:true,  why:"Editorial display + highly readable text serif — full serif system.", use:"Magazine · Publishing · Blog" },
  { s:"serif-serif", display:"Cormorant Garamond",body:"Lora",              dw:700, bw:400, xh:false, why:"Display Garamond + contemporary text serif — refined typographic warmth.", use:"Luxury · Heritage · Fashion" },
  { s:"serif-serif", display:"DM Serif Display", body:"Crimson Pro",        dw:400, bw:400, xh:true,  why:"Optical display cut + elegant text cut — matched visual weight.", use:"Editorial · Brand · Blog" },
  { s:"serif-serif", display:"Spectral",         body:"Lora",               dw:700, bw:400, xh:true,  why:"Book-grade display + warm text serif — pure literary system.", use:"Long-form · Publishing · Literary" },

  { s:"display-drama", display:"Modak",          body:"Fira Sans",          dw:400, bw:400, xh:false, why:"Ultra-bold display + clean humanist body — playful yet readable.", use:"Kids · Food · Fun brand" },
  { s:"display-drama", display:"Calistoga",      body:"IBM Plex Sans",      dw:400, bw:400, xh:false, why:"Heavy display with ink traps + rational corporate body.", use:"Brand · Poster · Type specimen" },
  { s:"display-drama", display:"Oswald",         body:"Lora",               dw:700, bw:400, xh:true,  why:"Condensed sans + warm serif body — news editorial power.", use:"News · Magazine · Editorial" },
  { s:"display-drama", display:"Bebas Neue",     body:"Lora",               dw:400, bw:400, xh:false, why:"All-caps display drama + scholarly serif body — stark contrast.", use:"Poster · Magazine · Film" },
  { s:"display-drama", display:"Barlow Condensed",body:"Merriweather",      dw:700, bw:300, xh:true,  why:"Tight condensed sans + wide-set readable serif — editorial authority.", use:"Feature · Long-form · News" },
  { s:"display-drama", display:"Anton",          body:"Lora",               dw:400, bw:400, xh:false, why:"Ultra-heavy display + elegant text serif — maximum weight contrast.", use:"Poster · Sports · Dramatic" },
  { s:"display-drama", display:"Fjalla One",     body:"Libre Baskerville",  dw:400, bw:400, xh:false, why:"Heavy condensed display + reliable text serif body.", use:"News · Nonprofit · Editorial" },
  { s:"display-drama", display:"Yeseva One",     body:"Crimson Text",       dw:400, bw:400, xh:false, why:"Decorative serif display with an elegant literary text body — dramatic editorial warmth.", use:"Culture · Literary · Magazine" },

  { s:"grotesque", display:"Montserrat",         body:"Montserrat",         dw:900, bw:300, xh:true,  why:"Montserrat Black vs Light — one typeface, maximum weight drama.", use:"Landing page · Poster · Bold brand" },
  { s:"grotesque", display:"Raleway",            body:"Open Sans",          dw:700, bw:400, xh:true,  why:"Display geometric + open humanist — elegant modern web pairing.", use:"Portfolio · Agency · Lifestyle" },
  { s:"grotesque", display:"Rubik",              body:"Rubik",              dw:700, bw:300, xh:true,  why:"Rounded variable grotesque — weight contrast within one warm family.", use:"App · Product · Friendly brand" },
  { s:"grotesque", display:"Poppins",            body:"Poppins",            dw:700, bw:300, xh:true,  why:"Geometric circular grotesque — weight contrast, perfectly rounded.", use:"Brand · App · Consumer product" },
  { s:"grotesque", display:"Poppins",            body:"Open Sans",          dw:700, bw:400, xh:true,  why:"Geometric circular headline + neutral open body — energetic and clean.", use:"E-commerce · Marketing · App" },
  { s:"grotesque", display:"Nunito",             body:"Open Sans",          dw:700, bw:400, xh:true,  why:"Rounded geometric headline + open humanist body — warm approachable pair.", use:"Wellness · Education · Lifestyle" },
  { s:"grotesque", display:"Karla",              body:"Karla",              dw:700, bw:400, xh:true,  why:"Variable grotesque with Kannada roots — elegant weight contrast.", use:"Brand · Minimal · International" },
  { s:"grotesque", display:"Figtree",            body:"Inter",              dw:700, bw:400, xh:true,  why:"Modern friendly grotesque + reliable system body — contemporary product.", use:"SaaS · App · Modern web" },
  { s:"grotesque", display:"Syne",               body:"Inter",              dw:800, bw:400, xh:true,  why:"Creative variable display + neutral system body — agency feel.", use:"Agency · Portfolio · Creative" },
  { s:"grotesque", display:"Onest",              body:"Onest",              dw:700, bw:300, xh:true,  why:"Contemporary variable grotesque — systematic weight hierarchy.", use:"Tech · Product · Modern" },
  { s:"grotesque", display:"Epilogue",           body:"Inter",              dw:700, bw:400, xh:true,  why:"Display grotesque + neutral system body — clear hierarchy.", use:"SaaS · Product · Documentation" },
  { s:"grotesque", display:"Albert Sans",        body:"Inter",              dw:700, bw:400, xh:true,  why:"Warm neo-grotesque + neutral system body — approachable authority.", use:"Startup · App · Corporate" },
  { s:"grotesque", display:"PT Sans",            body:"PT Sans",            dw:700, bw:400, xh:true,  why:"Paratype's humanist grotesque — weight contrast within one global family.", use:"Government · International · Publication" },
  { s:"grotesque", display:"PT Sans",            body:"PT Serif",           dw:700, bw:400, xh:true,  why:"Superfamily pairing — bold PT Sans with its matching PT Serif body for perfect harmony.", use:"Content-heavy sites · Publication · International" },
];

const STRATEGIES = [
  { id:"all",          label:"All",            vibe:"All 147 curated pairs across 7 strategies",                       gradient:T.gradViolet  },
  { id:"contrast",     label:"Contrast",       vibe:"Serif display + sans body — the timeless editorial formula.",     gradient:T.gradViolet  },
  { id:"humanist",     label:"Humanist",       vibe:"High-impact condensed headlines + readable sans body.",           gradient:T.gradMagenta },
  { id:"mono",         label:"Mono Accent",    vibe:"Geometric or sans headline + monospaced body for tech.",          gradient:T.gradOrange  },
  { id:"slab",         label:"Slab Power",     vibe:"Slab serif display + sans body — journalistic authority.",        gradient:T.gradCoral   },
  { id:"serif-serif",  label:"Serif Stack",    vibe:"Two serifs — varied optical size and weight. Literary depth.",    gradient:T.gradViolet  },
  { id:"display-drama",label:"Display Drama",  vibe:"Condensed/fat display + soft serif body. Cinematic tension.",     gradient:T.gradMagenta },
  { id:"grotesque",    label:"Grotesque",      vibe:"Sans + sans — hierarchy through weight alone. Swiss clarity.",    gradient:T.gradOrange  },
];

const PREVIEW_TEXTS = [
  "The quick brown fox", "Design is intelligence",
  "Form follows function", "Less is more",
  "Grid defines freedom", "Type sets the mood",
  "Contrast creates life", "Space breathes meaning",
  "Beauty in simplicity",  "Bold ideas start here",
];

function makeFontUrl(names: string[]) {
  const families = [...new Set(names)].map(n=>`family=${n.replace(/ /g,"+")}:wght@300;400;600;700;800`).join("&");
  return `https://fonts.googleapis.com/css2?${families}&display=swap`;
}

function FontPairing() {
  const [strategy, setStrategy]   = useState("all");
  const [pairIdx,  setPairIdx]    = useState(0);
  const [customText, setCustomText] = useState("");
  const [fontSize,   setFontSize]   = useState(54);
  const [history, setHistory]       = useState([{strategy:"all", pairIdx:0}]);
  const [histIdx, setHistIdx]       = useState(0);

  const pool = strategy === "all" ? PAIR_DB : PAIR_DB.filter((p:any) => p.s === strategy);
  const safeIdx = pairIdx % Math.max(pool.length, 1);
  const pair    = pool[safeIdx] || PAIR_DB[0];
  const strat   = STRATEGIES.find(s => s.id === strategy) || STRATEGIES[0];
  const previewText = customText || PREVIEW_TEXTS[safeIdx % PREVIEW_TEXTS.length];

  useEffect(() => {
    const url = makeFontUrl([pair.display, pair.body]);
    if (!document.querySelector(`link[href="${url}"]`)) {
      const link = document.createElement("link");
      link.rel = "stylesheet"; link.href = url;
      document.head.appendChild(link);
    }
  }, [pair.display, pair.body]);

  function pushHistory(s: string, idx: number) {
    const next = [...history.slice(0, histIdx + 1), {strategy:s, pairIdx:idx}];
    setHistory(next); setHistIdx(next.length - 1);
  }

  function regenerate() {
    const currentPool = strategy === "all" ? PAIR_DB : PAIR_DB.filter((p:any) => p.s === strategy);
    let next = Math.floor(Math.random() * currentPool.length);
    if (currentPool.length > 1 && next === safeIdx) next = (next + 1) % currentPool.length;
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

  const catScore   = pair.s !== "grotesque" ? 92 : 65;
  const xhScore    = pair.xh ? 96 : 72;
  const wDiff      = Math.abs(pair.dw - pair.bw);
  const wScore     = wDiff >= 300 ? 90 : wDiff >= 200 ? 78 : 62;

  const currentPool = strategy === "all" ? PAIR_DB : PAIR_DB.filter((p:any) => p.s === strategy);

  return (
    <div style={{display:"flex",gap:24,flexDirection:"column"}}>
      <div style={{display:"flex",gap:10,alignItems:"center",flexWrap:"wrap"}}>
        <div style={{display:"flex",gap:6,flexWrap:"nowrap",flex:1,overflowX:"auto",scrollbarWidth:"none"}}>
          {STRATEGIES.map(s => (
            <button key={s.id} onClick={() => switchStrategy(s.id)}
              style={{padding:"6px 14px",borderRadius:"var(--radius-pill)",border:"none",cursor:"pointer",
                fontFamily:"var(--font-body)",fontSize:12,fontWeight:strategy===s.id?500:400,
                background:strategy===s.id ? "var(--color-inverse-canvas)" : "var(--color-surface-1)",
                color:strategy===s.id ? "var(--color-canvas)" : "var(--color-ink-muted)",
                whiteSpace:"nowrap",transition:"all .12s"}}>
              {s.label}
              {s.id!=="all" && <span style={{marginLeft:6,fontSize:10,opacity:0.6}}>
                {PAIR_DB.filter((p:any)=>p.s===s.id).length}
              </span>}
            </button>
          ))}
        </div>
        <div style={{display:"flex",gap:8,flexShrink:0}}>
          <button onClick={goBack}    disabled={histIdx===0} style={{...ss.btnSec,padding:"10px 14px",opacity:histIdx===0?0.3:1}}>←</button>
          <button onClick={goForward} disabled={histIdx===history.length-1} style={{...ss.btnSec,padding:"10px 14px",opacity:histIdx===history.length-1?0.3:1}}>→</button>
          <button onClick={regenerate} style={{...ss.btnPri,display:"flex",alignItems:"center",gap:8}}>
            <span style={{fontSize:15,lineHeight:1}}>↺</span>
            Regenerate
          </button>
        </div>
      </div>

      <div style={{fontFamily:"var(--font-body)",fontSize:11,color:"var(--color-ink-muted)",marginBottom:16}}>
        Showing pair {safeIdx+1} of {currentPool.length} in <span style={{color:T.inkMuted}}>{strat.label}</span>
      </div>

      <div style={{background:"var(--color-surface-1)",borderRadius:"var(--radius-xl)",padding:40,border:"1px solid rgba(255,255,255,0.06)",position:"relative",overflow:"hidden",minHeight:260}}>
        <div style={{position:"absolute",top:-80,right:-80,width:280,height:280,borderRadius:"50%",background:strat.gradient,opacity:0.13,filter:"blur(70px)",pointerEvents:"none"}}/>
        <div style={{display:"flex",gap:7,marginBottom:22,flexWrap:"wrap"}}>
          <span style={{padding:"4px 10px",borderRadius:6,background:T.surface2,color:T.inkMuted,fontFamily:"var(--font-body)",fontSize:11,fontWeight:500}}>
            {strat.label}
          </span>
          <span style={{padding:"4px 10px",borderRadius:6,background:T.surface2,color:T.inkMuted,fontFamily:"var(--font-body)",fontSize:11}}>
            {pair.xh ? "✓ Matched x-height" : "Contrasting x-height"}
          </span>
          <span style={{padding:"4px 10px",borderRadius:6,background:T.surface2,color:T.inkMuted,fontFamily:"var(--font-body)",fontSize:11}}>
            Δ weight {Math.abs(pair.dw - pair.bw)}
          </span>
        </div>

        <div style={{
          fontFamily:`'${pair.display}',serif,sans-serif`,
          fontWeight:pair.dw,
          fontSize:Math.min(fontSize, 80),
          letterSpacing:fontSize > 52 ? "-2px" : "-0.5px",
          lineHeight:0.95,
          color:T.ink,
          marginBottom:20,
          wordBreak:"break-word",
        }}>
          {previewText}
        </div>

        <div style={{height:1,background:T.hairline,marginBottom:20}}/>

        <p style={{
          fontFamily:`'${pair.body}',sans-serif,serif`,
          fontWeight:pair.bw,
          fontSize:16, lineHeight:1.65, color:T.inkMuted,
          letterSpacing:"-0.16px", margin:0, maxWidth:580,
        }}>
          {pair.why} — Body specimen in{" "}
          <strong style={{color:T.ink,fontWeight:600}}>{pair.body}</strong> at 16px.
        </p>
        <p style={{fontFamily:`'${pair.body}',sans-serif,serif`,fontWeight:pair.bw,fontSize:13,lineHeight:1.5,color:T.inkDim,letterSpacing:"-0.13px",margin:"8px 0 0"}}>
          Best for: {pair.use}
        </p>

        <div style={{display:"flex",gap:10,marginTop:24,flexWrap:"wrap"}}>
          {[{label:"Display",name:pair.display,w:pair.dw},{label:"Body",name:pair.body,w:pair.bw}].map((f:any)=>(
            <div key={f.label} style={{background:"var(--color-surface-1)",borderRadius:"var(--radius-xl)",padding:"16px",border:"1px solid rgba(255,255,255,0.06)",flex:1,minWidth:120}}>
              <div style={{fontFamily:"var(--font-body)",fontSize:10,color:T.inkMuted,letterSpacing:".06em",textTransform:"uppercase",marginBottom:4}}>{f.label}</div>
              <div style={{fontFamily:`'${f.name}',serif,sans-serif`,fontWeight:f.w,fontSize:16,color:T.ink,marginBottom:2}}>{f.name}</div>
              <div style={{fontFamily:"var(--font-body)",fontSize:10,color:T.inkDim}}>weight {f.w}</div>
            </div>
          ))}
          <div style={{background:"var(--color-surface-1)",borderRadius:"var(--radius-xl)",padding:"16px",border:"1px solid rgba(255,255,255,0.06)",minWidth:130}}>
            <div style={{fontFamily:"var(--font-body)",fontSize:10,color:T.inkMuted,letterSpacing:".06em",textTransform:"uppercase",marginBottom:8}}>Pairing score</div>
            {[["Category",catScore],["X-height",xhScore],["Weight Δ",wScore]].map(([k,v]:any)=>(
              <div key={k} style={{marginBottom:6}}>
                <div style={{display:"flex",justifyContent:"space-between",marginBottom:2}}>
                  <span style={{fontFamily:"var(--font-body)",fontSize:10,color:T.inkDim}}>{k}</span>
                  <span style={{fontFamily:"var(--font-mono)",fontSize:10,color:v>80?"#4ade80":v>65?"#fbbf24":"#f87171"}}>{v}</span>
                </div>
                <div style={{height:3,background:T.surface1,borderRadius:100}}>
                  <div style={{width:`${v}%`,height:"100%",background:v>80?"#4ade80":v>65?"#fbbf24":"#f87171",borderRadius:100}}/>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div style={{display:"flex",gap:16,flexWrap:"wrap",alignItems:"center"}}>
        <div style={{flex:1,minWidth:200}}>
          <label style={ss.label}>Preview text</label>
          <input value={customText} onChange={(e:any)=>setCustomText(e.target.value)} style={ss.input} placeholder={previewText}/>
        </div>
        <div style={{width:160}}>
          <label style={ss.label}>Display size — {fontSize}px</label>
          <input type="range" min={24} max={96} value={fontSize} onChange={(e:any)=>setFontSize(+e.target.value)} style={{width:"100%",accentColor:T.accentBlue}}/>
        </div>
        <a href={`https://fonts.google.com/specimen/${encodeURIComponent(pair.display)}`} target="_blank" rel="noopener" style={{...ss.btnSec,textDecoration:"none",whiteSpace:"nowrap",fontSize:12}}>
          ↗ {pair.display}
        </a>
        <a href={`https://fonts.google.com/specimen/${encodeURIComponent(pair.body)}`} target="_blank" rel="noopener" style={{...ss.btnSec,textDecoration:"none",whiteSpace:"nowrap",fontSize:12}}>
          ↗ {pair.body}
        </a>
      </div>

      <div style={{display:"flex",gap:5,alignItems:"center",paddingTop:4}}>
        <span style={{fontFamily:"var(--font-body)",fontSize:11,color:T.inkDim}}>History:</span>
        {history.map((h:any,i:number)=>(
          <button key={i} onClick={()=>{setHistIdx(i);setStrategy(h.strategy);setPairIdx(h.pairIdx);}}
            style={{width:7,height:7,borderRadius:"50%",border:"none",cursor:"pointer",
              background:i===histIdx?"var(--color-inverse-canvas)":"var(--color-surface-2)",padding:0,transition:"background .15s"}}/>
        ))}
        <span style={{fontFamily:"var(--font-mono)",fontSize:10,color:T.inkDim,marginLeft:6}}>{pair.display} + {pair.body}</span>
      </div>
    </div>
  );
}

// ── CONTRAST CHECKER ─────────────────────────────────────────────────────────

function hexToRgbCC(hex: string): [number,number,number] {
  const h = hex.replace(/^#/,"");
  const full = h.length===3?h.split("").map((c:string)=>c+c).join(""):h;
  return [parseInt(full.slice(0,2),16),parseInt(full.slice(2,4),16),parseInt(full.slice(4,6),16)];
}
function rgbToHexCC([r,g,b]: [number,number,number]) {
  return "#"+[r,g,b].map(v=>Math.round(Math.max(0,Math.min(255,v))).toString(16).padStart(2,"0")).join("");
}
function relLum([r,g,b]: [number,number,number]) {
  const c=[r,g,b].map(v=>{const s=v/255;return s<=0.03928?s/12.92:Math.pow((s+0.055)/1.055,2.4);});
  return 0.2126*c[0]+0.7152*c[1]+0.0722*c[2];
}
function cRatio(h1: string,h2: string){
  try{const l1=relLum(hexToRgbCC(h1)),l2=relLum(hexToRgbCC(h2));const[hi,lo]=l1>l2?[l1,l2]:[l2,l1];return(hi+0.05)/(lo+0.05);}catch{return 1;}
}
function isHex(h: string){return /^#[0-9a-fA-F]{6}$/.test(h);}

function rgbToHsl([r,g,b]: [number,number,number]): [number,number,number] {
  r/=255;g/=255;b/=255;
  const max=Math.max(r,g,b),min=Math.min(r,g,b);
  let h=0,s=0,l=(max+min)/2;
  if(max!==min){
    const d=max-min;s=l>0.5?d/(2-max-min):d/(max+min);
    switch(max){case r:h=(g-b)/d+(g<b?6:0);break;case g:h=(b-r)/d+2;break;default:h=(r-g)/d+4;}
    h/=6;
  }
  return[Math.round(h*360),Math.round(s*100),Math.round(l*100)];
}
function hslToRgb(h: number,s: number,l: number): [number,number,number] {
  h/=360;s/=100;l/=100;
  const hue2rgb=(p: number,q: number,t: number)=>{if(t<0)t+=1;if(t>1)t-=1;if(t<1/6)return p+(q-p)*6*t;if(t<1/2)return q;if(t<2/3)return p+(q-p)*(2/3-t)*6;return p;};
  if(s===0){const v=Math.round(l*255);return[v,v,v];}
  const q=l<0.5?l*(1+s):l+s-l*s,p=2*l-q;
  return[Math.round(hue2rgb(p,q,h+1/3)*255),Math.round(hue2rgb(p,q,h)*255),Math.round(hue2rgb(p,q,h-1/3)*255)];
}

function generateSuggestions(fgHex: string, bgHex: string, targetRatio=4.5) {
  if (!isHex(fgHex)||!isHex(bgHex)) return [];
  const bgRgb = hexToRgbCC(bgHex);
  const fgHsl = rgbToHsl(hexToRgbCC(fgHex));
  const suggestions: any[] = [];

  for (let l=0; l<=100; l+=2) {
    const rgb = hslToRgb(fgHsl[0], fgHsl[1], l);
    const hex = rgbToHexCC(rgb);
    if (cRatio(hex, bgHex) >= targetRatio) {
      suggestions.push({ hex, label:"Adjusted lightness", theory:"Same hue, adjusted luminance", score:100 });
      break;
    }
  }
  for (let l=100; l>=0; l-=2) {
    const rgb = hslToRgb(fgHsl[0], fgHsl[1], l);
    const hex = rgbToHexCC(rgb);
    if (cRatio(hex, bgHex) >= targetRatio) {
      const h = suggestions.find((s:any)=>s.label==="Adjusted lightness");
      if (!h || h.hex !== hex) suggestions.push({ hex, label:"Adjusted lightness (dark)", theory:"Same hue, darkened", score:95 });
      break;
    }
  }

  const compH = (fgHsl[0]+180)%360;
  for (let l=10; l<=95; l+=3) {
    const rgb = hslToRgb(compH, fgHsl[1], l);
    const hex = rgbToHexCC(rgb);
    if (cRatio(hex, bgHex) >= targetRatio) {
      suggestions.push({ hex, label:"Complementary", theory:"Opposite hue on color wheel — maximum contrast energy", score:88 });
      break;
    }
  }

  for (const offset of [30, -30, 60, -60]) {
    const aH = ((fgHsl[0]+offset)%360+360)%360;
    for (let l=5; l<=98; l+=3) {
      const rgb = hslToRgb(aH, fgHsl[1], l);
      const hex = rgbToHexCC(rgb);
      if (cRatio(hex, bgHex) >= targetRatio) {
        if (!suggestions.find((s:any)=>s.hex===hex)) {
          suggestions.push({ hex, label:`Analogous (${offset>0?"+":""}${offset}°)`, theory:"Adjacent hue — harmonious, related feel", score:82 });
        }
        break;
      }
    }
    if (suggestions.length >= 6) break;
  }

  for (const offset of [120, 240]) {
    const tH = (fgHsl[0]+offset)%360;
    for (let l=5; l<=98; l+=4) {
      const rgb = hslToRgb(tH, fgHsl[1], l);
      const hex = rgbToHexCC(rgb);
      if (cRatio(hex, bgHex) >= targetRatio) {
        if (!suggestions.find((s:any)=>s.hex===hex)) {
          suggestions.push({ hex, label:`Triadic (+${offset}°)`, theory:"Triadic harmony — vibrant, balanced palette", score:78 });
        }
        break;
      }
    }
  }

  if (cRatio("#ffffff", bgHex) >= targetRatio) suggestions.push({ hex:"#ffffff", label:"Pure white", theory:"Maximum contrast — always safe on dark backgrounds", score:70 });
  if (cRatio("#000000", bgHex) >= targetRatio) suggestions.push({ hex:"#000000", label:"Pure black", theory:"Maximum contrast — always safe on light backgrounds", score:70 });

  return suggestions.slice(0, 6);
}

function ContrastChecker() {
  const [fg, setFg] = useState("#ffffff");
  const [bg, setBg] = useState("#0a0a0b");
  const [fgI,setFgI]= useState("#ffffff");
  const [bgI,setBgI]= useState("#0a0a0b");

  const ratio   = cRatio(isHex(fg)?fg:"#fff", isHex(bg)?bg:"#000");
  const rStr    = ratio.toFixed(2);
  const rc      = ratio>=7?"#4ade80":ratio>=4.5?"#86efac":ratio>=3?"#fbbf24":"#f87171";
  const failing = ratio < 4.5;
  const suggestions = failing ? generateSuggestions(fg, bg, 4.5) : [];

  function syncFg(v: string){setFgI(v);if(isHex(v))setFg(v);}
  function syncBg(v: string){setBgI(v);if(isHex(v))setBg(v);}
  function swap(){setFg(isHex(bg)?bg:fg);setBg(isHex(fg)?fg:bg);setFgI(bgI);setBgI(fgI);}

  const levels = [
    {l:"AA Normal text",   p:ratio>=4.5, r:"4.5:1"},
    {l:"AA Large text",    p:ratio>=3,   r:"3.0:1"},
    {l:"AA UI components", p:ratio>=3,   r:"3.0:1"},
    {l:"AAA Normal text",  p:ratio>=7,   r:"7.0:1"},
    {l:"AAA Large text",   p:ratio>=4.5, r:"4.5:1"},
  ];

  return (
    <div style={{display:"flex",gap:24,flexDirection:"column"}}>
      <div style={{borderRadius:"var(--radius-xl)",padding:40,background:isHex(bg)?bg:T.canvas,border:"1px solid rgba(255,255,255,0.06)",minHeight:160,display:"flex",flexDirection:"column",justifyContent:"center",position:"relative"}}>
        <div style={{fontFamily:"var(--font-body)",letterSpacing:"-3px",fontSize:64,fontWeight:700,lineHeight:1,color:isHex(fg)?fg:T.ink}}>Aa</div>
        <p style={{fontFamily:"var(--font-body)",fontSize:15,lineHeight:1.5,letterSpacing:"-0.15px",margin:"12px 0 0",color:isHex(fg)?fg:T.ink,opacity:0.85}}>
          Contrast ratio: <strong>{rStr}:1</strong>
        </p>
        <div style={{position:"absolute",top:20,right:20,padding:"8px 16px",borderRadius:100,background:"rgba(0,0,0,0.55)",backdropFilter:"blur(8px)",fontFamily:"var(--font-body)",fontSize:20,fontWeight:700,color:rc,letterSpacing:"-0.5px"}}>
          {rStr}:1
        </div>
        {failing && (
          <div style={{position:"absolute",bottom:16,right:16,padding:"5px 12px",borderRadius:8,background:"rgba(239,68,68,0.18)",border:"1px solid rgba(239,68,68,0.35)",fontFamily:"var(--font-body)",fontSize:11,color:"#f87171"}}>
            Fails WCAG AA
          </div>
        )}
      </div>

      <div style={{display:"flex",gap:16,alignItems:"flex-end",flexWrap:"wrap"}}>
        <div style={{flex:1,minWidth:160}}>
          <label style={ss.label}>Foreground (text)</label>
          <div style={{display:"flex",gap:8,alignItems:"center"}}>
            <input type="color" value={isHex(fg)?fg:"#fff"} onChange={(e:any)=>{setFg(e.target.value);setFgI(e.target.value);}} style={{width:44,height:44,borderRadius:10,border:`1px solid ${T.hairline}`,background:"none",cursor:"pointer",padding:2}}/>
            <input value={fgI} onChange={(e:any)=>syncFg(e.target.value)} style={{...ss.input,fontFamily:"var(--font-mono)",letterSpacing:"0.05em"}} maxLength={7}/>
          </div>
        </div>
        <button onClick={swap} style={{background:"var(--color-surface-1)",color:"var(--color-ink)",borderRadius:"var(--radius-pill)",border:"none",cursor:"pointer",fontFamily:"var(--font-body)",width:44,height:44,fontSize:18,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>⇅</button>
        <div style={{flex:1,minWidth:160}}>
          <label style={ss.label}>Background</label>
          <div style={{display:"flex",gap:8,alignItems:"center"}}>
            <input type="color" value={isHex(bg)?bg:"#000"} onChange={(e:any)=>{setBg(e.target.value);setBgI(e.target.value);}} style={{width:44,height:44,borderRadius:10,border:`1px solid ${T.hairline}`,background:"none",cursor:"pointer",padding:2}}/>
            <input value={bgI} onChange={(e:any)=>syncBg(e.target.value)} style={{...ss.input,fontFamily:"var(--font-mono)",letterSpacing:"0.05em"}} maxLength={7}/>
          </div>
        </div>
      </div>

      <div style={{background:"var(--color-surface-1)",borderRadius:"var(--radius-xl)",padding:24,border:"1px solid rgba(255,255,255,0.06)"}}>
        <div style={{display:"flex",justifyContent:"space-between",marginBottom:10}}>
          <span style={{fontFamily:"var(--font-body)",fontSize:13,color:T.inkMuted}}>Contrast ratio</span>
          <span style={{fontFamily:"var(--font-body)",fontSize:13,fontWeight:600,color:rc}}>{rStr}:1</span>
        </div>
        <div style={{height:6,background:T.surface2,borderRadius:100,overflow:"hidden",position:"relative"}}>
          <div style={{width:`${Math.min(((ratio-1)/20)*100,100)}%`,height:"100%",background:rc,borderRadius:100,transition:"width .3s"}}/>
        </div>
        <div style={{display:"flex",justifyContent:"space-between",marginTop:6}}>
          <span style={{fontFamily:"var(--font-body)",fontSize:11,color:T.inkMuted}}>1:1</span>
          <span style={{fontFamily:"var(--font-body)",fontSize:11,color:T.inkMuted}}>3 · 4.5 · 7 · 21:1</span>
        </div>
      </div>

      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(180px,1fr))",gap:10}}>
        {levels.map((l:any)=>(
          <div key={l.l} style={{background:"var(--color-surface-1)",borderRadius:"var(--radius-lg)",padding:14,border:`1px solid ${l.p?"#166534":"#7f1d1d"}`}}>
            <div style={{display:"flex",justifyContent:"space-between",marginBottom:6}}>
              <span style={{fontFamily:"var(--font-body)",fontSize:11,color:T.inkMuted,lineHeight:1.3}}>{l.l}</span>
              <span style={{fontSize:16}}>{l.p?"✓":"✗"}</span>
            </div>
            <div style={{fontFamily:"var(--font-body)",fontSize:13,fontWeight:600,color:l.p?"#4ade80":"#f87171"}}>{l.p?"Pass":"Fail"}</div>
            <div style={{fontFamily:"var(--font-body)",fontSize:11,color:T.inkMuted}}>Requires {l.r}</div>
          </div>
        ))}
      </div>

      {failing && (
        <div style={{background:"var(--color-surface-1)",borderRadius:"var(--radius-xl)",border:"1px solid rgba(239,68,68,0.3)",padding:24}}>
          <div style={{marginBottom:16}}>
            <div style={{fontFamily:"var(--font-body)",fontSize:13,fontWeight:600,color:T.ink,marginBottom:2}}>Suggested foreground colors</div>
            <div style={{fontFamily:"var(--font-body)",fontSize:11,color:T.inkMuted}}>All achieve WCAG AA (4.5:1) against your background, maintaining color harmony</div>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(200px,1fr))",gap:10}}>
            {suggestions.map((s:any,i:number)=>(
              <button key={i} onClick={()=>{setFg(s.hex);setFgI(s.hex);}} style={{background:"var(--color-surface-2)",borderRadius:"var(--radius-lg)",padding:14,border:`1px solid ${T.hairline}`,cursor:"pointer",textAlign:"left",transition:"border-color .15s"}}
                onMouseEnter={(e:any)=>e.currentTarget.style.borderColor=s.hex}
                onMouseLeave={(e:any)=>e.currentTarget.style.borderColor=T.hairline}>
                <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:8}}>
                  <div style={{width:32,height:32,borderRadius:8,background:s.hex,border:`1px solid rgba(255,255,255,0.1)`,flexShrink:0}}/>
                  <div>
                    <div style={{fontFamily:"var(--font-mono)",fontSize:12,color:T.ink}}>{s.hex.toUpperCase()}</div>
                    <div style={{fontFamily:"var(--font-body)",fontSize:10,color:T.inkMuted}}>{cRatio(s.hex,bg).toFixed(1)}:1</div>
                  </div>
                </div>
                <div style={{fontFamily:"var(--font-body)",fontSize:11,fontWeight:600,color:T.ink,marginBottom:2}}>{s.label}</div>
                <div style={{fontFamily:"var(--font-body)",fontSize:10,color:T.inkMuted,lineHeight:1.4}}>{s.theory}</div>
                <div style={{marginTop:8,padding:"6px 10px",borderRadius:6,background:bg,fontFamily:"var(--font-body)",fontSize:11,color:s.hex,fontWeight:600}}>
                  Aa — preview
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── IMAGE CONVERTER ───────────────────────────────────────────────────────────
function ImageConverter(){
  const [preview,setPreview]=useState<string|null>(null);
  const [format,setFormat]=useState("image/png");
  const [quality,setQuality]=useState(92);
  const [scale,setScale]=useState(100);
  const [converted,setConverted]=useState<any>(null);
  const [info,setInfo]=useState<any>(null);
  const [converting,setConverting]=useState(false);
  const canvasRef=useRef<HTMLCanvasElement>(null);

  function loadFile(f: File|null){
    if(!f||!f.type.startsWith("image/"))return;
    setConverted(null);
    const url=URL.createObjectURL(f);
    setPreview(url);
    const img=new Image();
    img.onload=()=>setInfo({w:img.naturalWidth,h:img.naturalHeight,size:(f.size/1024).toFixed(1),name:f.name});
    img.src=url;
  }
  function convert(){
    if(!preview||!canvasRef.current)return;
    setConverting(true);
    const img=new Image();
    img.onload=()=>{
      const cvs=canvasRef.current!;
      const w=Math.round(img.naturalWidth*scale/100),h=Math.round(img.naturalHeight*scale/100);
      cvs.width=w;cvs.height=h;
      cvs.getContext("2d")!.drawImage(img,0,0,w,h);
      const q=format==="image/png"?1:quality/100;
      cvs.toBlob(blob=>{
        if(!blob)return;
        setConverted({url:URL.createObjectURL(blob),size:(blob.size/1024).toFixed(1),w,h,format,ext:format.split("/")[1]});
        setConverting(false);
      },format,q);
    };
    img.src=preview;
  }
  return(
    <div style={{display:"flex",gap:20,flexDirection:"column"}}>
      <canvas ref={canvasRef} style={{display:"none"}}/>
      {!preview?(
        <div onClick={()=>document.getElementById("img-inp")?.click()} onDragOver={(e:any)=>e.preventDefault()} onDrop={(e:any)=>{e.preventDefault();loadFile(e.dataTransfer.files[0]);}}
          style={{borderRadius:"var(--radius-xl)",border:"2px dashed var(--color-hairline)",background:"var(--color-surface-1)",padding:"60px 40px",display:"flex",flexDirection:"column",alignItems:"center",cursor:"pointer",gap:12}}
          onMouseEnter={(e:any)=>e.currentTarget.style.borderColor=T.accentBlue} onMouseLeave={(e:any)=>e.currentTarget.style.borderColor=T.hairline}>
          <div style={{width:56,height:56,borderRadius:14,background:T.surface2,display:"flex",alignItems:"center",justifyContent:"center"}}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#666" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/>
            </svg>
          </div>
          <span style={{fontFamily:"var(--font-body)",fontSize:16,fontWeight:500,color:T.ink}}>Drop an image here</span>
          <span style={{fontFamily:"var(--font-body)",fontSize:13,color:T.inkMuted}}>or click to browse — PNG, JPEG, WebP</span>
          <input id="img-inp" type="file" accept="image/*" style={{display:"none"}} onChange={(e:any)=>loadFile(e.target.files[0])}/>
        </div>
      ):(
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:20}}>
          {[{label:"Original",src:preview,meta:info?`${info.w}×${info.h} · ${info.size}KB`:""},{label:"Output",src:converted?.url,meta:converted?`${converted.w}×${converted.h} · ${converted.size}KB`:""}].map((p:any)=>(
            <div key={p.label} style={{background:"var(--color-surface-1)",borderRadius:"var(--radius-xl)",overflow:"hidden",border:"1px solid rgba(255,255,255,0.06)"}}>
              <div style={{padding:"10px 16px",borderBottom:`1px solid ${T.hairline}`,display:"flex",justifyContent:"space-between"}}>
                <span style={{fontFamily:"var(--font-body)",fontSize:12,color:T.inkMuted}}>{p.label}</span>
                {p.meta&&<span style={{fontFamily:"var(--font-mono)",fontSize:11,color:T.inkMuted}}>{p.meta}</span>}
              </div>
              {p.src?<img src={p.src} alt={p.label} style={{width:"100%",height:180,objectFit:"contain",background:"var(--color-canvas)"}}/>:
                <div style={{height:180,display:"flex",alignItems:"center",justifyContent:"center",color:T.inkMuted,fontFamily:"var(--font-body)",fontSize:13}}>
                  {converting?"Converting…":"Configure below →"}
                </div>}
            </div>
          ))}
        </div>
      )}
      {preview&&(
        <div style={{background:"var(--color-surface-1)",borderRadius:"var(--radius-xl)",padding:24,border:"1px solid rgba(255,255,255,0.06)",display:"flex",gap:20,flexWrap:"wrap",alignItems:"flex-end"}}>
          <div>
            <label style={ss.label}>Format</label>
            <div style={{display:"flex",gap:8}}>
              {[["image/png","PNG"],["image/jpeg","JPEG"],["image/webp","WebP"]].map(([m,l])=>(
                <button key={m} onClick={()=>setFormat(m)} style={{padding:"6px 14px",borderRadius:"var(--radius-pill)",border:"none",cursor:"pointer",fontFamily:"var(--font-body)",fontSize:12,fontWeight:format===m?500:400,background:format===m?"var(--color-inverse-canvas)":"var(--color-surface-1)",color:format===m?"var(--color-canvas)":"var(--color-ink-muted)"}}>{l}</button>
              ))}
            </div>
          </div>
          {format!=="image/png"&&<div><label style={ss.label}>Quality — {quality}%</label><input type="range" min={10} max={100} value={quality} onChange={(e:any)=>setQuality(+e.target.value)} style={{width:120,accentColor:T.accentBlue}}/></div>}
          <div><label style={ss.label}>Scale — {scale}%</label><input type="range" min={10} max={200} value={scale} onChange={(e:any)=>setScale(+e.target.value)} style={{width:120,accentColor:T.accentBlue}}/></div>
          <div style={{display:"flex",gap:10,marginLeft:"auto"}}>
            <button onClick={()=>{setPreview(null);setConverted(null);setInfo(null);}} style={ss.btnSec}>↺ Reset</button>
            <button onClick={convert} style={ss.btnPri}>{converting?"Converting…":"Convert"}</button>
            {converted&&<a href={converted.url} download={`converted.${converted.ext}`} style={{...ss.btnPri,textDecoration:"none",display:"inline-flex",alignItems:"center"}}>↓ Download</a>}
          </div>
        </div>
      )}
    </div>
  );
}

// ── GRID CALCULATOR ───────────────────────────────────────────────────────────

const FORMATS = [
  {id:"a4",     label:"A4",           w:794,  h:1123, dw:"210mm",  dh:"297mm",  desc:"Standard editorial"},
  {id:"a3",     label:"A3",           w:1123, h:1587, dw:"297mm",  dh:"420mm",  desc:"Poster / exhibition"},
  {id:"a5",     label:"A5",           w:559,  h:794,  dw:"148mm",  dh:"210mm",  desc:"Flyer / booklet"},
  {id:"letter", label:"US Letter",    w:816,  h:1056, dw:"8.5in",  dh:"11in",   desc:"US standard"},
  {id:"post18", label:"Poster 18×24", w:1728, h:2304, dw:"18in",   dh:"24in",   desc:"US poster standard"},
  {id:"post24", label:"Poster 24×36", w:2304, h:3456, dw:"24in",   dh:"36in",   desc:"Large format"},
  {id:"square", label:"Square",       w:800,  h:800,  dw:"800px",  dh:"800px",  desc:"Social / album"},
  {id:"wide",   label:"16:9",         w:1920, h:1080, dw:"1920px", dh:"1080px", desc:"Screen / slides"},
  {id:"custom", label:"Custom",       w:800,  h:600,  dw:"",       dh:"",       desc:"Your dimensions"},
];

const GRID_SYSTEMS = [
  { id:"swiss",     label:"Swiss Modular",      icon:"⊞", cat:"Editorial", desc:"Müller-Brockmann's system: columns × rows = fields. Every margin and gutter derived from the baseline. The DNA of the International Typographic Style." },
  { id:"column",    label:"Column Grid",        icon:"≡", cat:"Editorial", desc:"Pure vertical divisions. Newspaper: 6-col. Magazine: 3-4 col. Web: 12-col. The workhorse of all editorial layout." },
  { id:"baseline",  label:"Baseline Grid",      icon:"⊟", cat:"Editorial", desc:"Dense horizontal lines set to your body type's leading. Aligns all type across every column. The typographer's essential tool." },
  { id:"golden",    label:"Golden Ratio",       icon:"φ", cat:"Harmonic",  desc:"φ = 1.618. The Fibonacci spiral in canvas form. Place your primary subject at the spiral's tightest point. Found in nature and every Renaissance masterpiece." },
  { id:"thirds",    label:"Rule of Thirds",     icon:"⊠", cat:"Harmonic",  desc:"Simplified golden ratio: 9-block 3×3 grid. Focal points at the four intersections. Classical composition from photography, poster, and painting." },
  { id:"radial",    label:"Radial / Polar",     icon:"◎", cat:"Poster",    desc:"Lines radiate from a central point, intersected by concentric rings. Creates a hypnotic bullseye. Perfect for event posters, music gigs, dramatic focal compositions." },
  { id:"isometric", label:"Isometric",          icon:"⬡", cat:"Poster",    desc:"Lines at 30° angles instead of 90°. Creates the illusion of 3D depth on a flat surface. Tech, web3, architectural and gaming aesthetics." },
  { id:"diagonal",  label:"Diagonal / Angular", icon:"⤡", cat:"Poster",    desc:"Entire grid tilted 45°. Horizontal lines = rest. Diagonal lines = speed, tension, kinetic energy. Streetwear, sports, Russian Constructivism." },
  { id:"compound",  label:"Compound",           icon:"⊕", cat:"Poster",    desc:"Two conflicting grids overlaid (e.g. 3-col + 4-col). Elements snap to different grids. Creates controlled chaos — complex rhythm that feels organic yet mathematical." },
];

function drawGrid(canvas: HTMLCanvasElement|null, system: string, params: Record<string,number>, fmtW: number, fmtH: number) {
  if (!canvas) return;
  const ctx = canvas.getContext("2d")!;
  const CW = canvas.width, CH = canvas.height;
  const sc = Math.min((CW-40)/fmtW, (CH-40)/fmtH);
  const PW = Math.round(fmtW*sc), PH = Math.round(fmtH*sc);
  const OX = Math.round((CW-PW)/2), OY = Math.round((CH-PH)/2);

  ctx.clearRect(0,0,CW,CH);
  ctx.fillStyle="#0d0d0f"; ctx.fillRect(0,0,CW,CH);
  ctx.shadowColor="rgba(0,0,0,0.6)"; ctx.shadowBlur=20;
  ctx.fillStyle="#1a1a1e"; ctx.fillRect(OX,OY,PW,PH);
  ctx.shadowBlur=0;
  ctx.strokeStyle="#323238"; ctx.lineWidth=1;
  ctx.strokeRect(OX+0.5,OY+0.5,PW-1,PH-1);

  const mg={t:params.mt*sc,b:params.mb*sc,l:params.ml*sc,r:params.mr*sc};
  const IW=PW-mg.l-mg.r, IH=PH-mg.t-mg.b;
  const IX=OX+mg.l, IY=OY+mg.t;
  const g=params.g*sc, bl=params.bl*sc;
  const cols=Math.max(params.cols,1), rows=Math.max(params.rows,1);
  const cw=(IW-g*(cols-1))/cols, rh=(IH-g*(rows-1))/rows;

  ctx.fillStyle="rgba(255,160,50,0.04)";
  ctx.fillRect(OX,OY,mg.l,PH); ctx.fillRect(OX+PW-mg.r,OY,mg.r,PH);
  ctx.fillRect(IX,OY,IW,mg.t); ctx.fillRect(IX,OY+PH-mg.b,IW,mg.b);
  ctx.setLineDash([3,3]); ctx.strokeStyle="rgba(255,160,50,0.4)"; ctx.lineWidth=0.75;
  ctx.strokeRect(IX+0.5,IY+0.5,IW-1,IH-1); ctx.setLineDash([]);

  function lbl(txt: string,x: number,y: number,col="#aaa",sz=9){
    ctx.save();ctx.font=`${sz}px Inter,sans-serif`;ctx.fillStyle=col;ctx.textAlign="center";ctx.textBaseline="middle";ctx.fillText(txt,x,y);ctx.restore();
  }
  function arrH(x1: number,y: number,x2: number,val: string,col="rgba(255,160,50,0.7)"){
    ctx.save();ctx.strokeStyle=col;ctx.lineWidth=0.75;
    ctx.beginPath();ctx.moveTo(x1,y);ctx.lineTo(x2,y);ctx.stroke();
    ctx.beginPath();ctx.moveTo(x1,y-4);ctx.lineTo(x1,y+4);ctx.stroke();
    ctx.beginPath();ctx.moveTo(x2,y-4);ctx.lineTo(x2,y+4);ctx.stroke();
    lbl(val,(x1+x2)/2,y-9,col,8);ctx.restore();
  }

  if(system==="swiss"||system==="column"){
    const numC=cols, numR=system==="swiss"?rows:1;
    const _cw=(IW-g*(numC-1))/numC;
    const _rh=numR>1?(IH-g*(numR-1))/numR:IH;
    for(let r=0;r<numR;r++){
      for(let c=0;c<numC;c++){
        const x=IX+c*(_cw+g), y=IY+r*(_rh+g);
        ctx.fillStyle=(r+c)%2===0?"rgba(99,102,241,0.18)":"rgba(99,102,241,0.10)";
        ctx.fillRect(x,y,_cw,_rh);
        ctx.strokeStyle="rgba(99,102,241,0.45)";ctx.lineWidth=0.6;
        ctx.strokeRect(x+0.5,y+0.5,_cw-0.5,_rh-0.5);
        if(numC<=8&&numR<=6) lbl(`${c+1}${system==="swiss"?`,${r+1}`:""}`,x+_cw/2,y+_rh/2,"rgba(165,180,252,0.6)");
      }
    }
    if(system==="swiss"&&numC>=2&&numR>=2){
      ctx.fillStyle="rgba(168,85,247,0.25)";ctx.fillRect(IX,IY,_cw*2+g,_rh*2+g);
      ctx.strokeStyle="rgba(168,85,247,0.85)";ctx.lineWidth=1.5;
      ctx.strokeRect(IX+0.5,IY+0.5,_cw*2+g-1,_rh*2+g-1);
      lbl("spatial zone",IX+(_cw*2+g)/2,IY+(_rh*2+g)/2,"rgba(216,180,254,0.9)");
    }
    for(let c=0;c<numC-1;c++){
      ctx.fillStyle="rgba(250,204,21,0.06)";
      ctx.fillRect(IX+c*(_cw+g)+_cw,IY,g,IH);
    }
    arrH(IX,IY+IH+sc*3,IX+_cw,IY+IH+sc*3,`${(_cw/sc).toFixed(0)}px col`);
    if(g>0) arrH(IX+_cw,IY+IH+sc*3,IX+_cw+g,IY+IH+sc*3,`${(g/sc).toFixed(0)}px`,"rgba(250,204,21,0.7)");
  }
  else if(system==="baseline"){
    for(let c=0;c<cols;c++){const x=IX+c*(cw+g);ctx.fillStyle="rgba(99,102,241,0.07)";ctx.fillRect(x,IY,cw,IH);}
    if(bl>1){
      let li=0;
      for(let y=IY;y<=IY+IH;y+=bl){
        ctx.strokeStyle=li%4===0?"rgba(34,197,94,0.8)":"rgba(34,197,94,0.2)";
        ctx.lineWidth=li%4===0?0.9:0.4;
        ctx.beginPath();ctx.moveTo(IX,y);ctx.lineTo(IX+IW,y);ctx.stroke();
        li++;
      }
      ctx.fillStyle="rgba(255,255,255,0.11)";
      for(let y=IY+bl;y<IY+IH-bl;y+=bl){ctx.fillRect(IX+8,y-bl+2,(0.55+Math.random()*0.35)*IW,bl-3);}
      arrH(IX+IW+4,IY,IX+IW+4,IY+bl,`${params.bl}px`,"rgba(34,197,94,0.8)");
    }
    lbl(`${params.bl}px baseline · ${cols} col${cols>1?"s":""}`,OX+PW/2,OY+PH-8,"rgba(34,197,94,0.6)");
  }
  else if(system==="golden"){
    const phi=1.618;
    const squares: any[]=[];let x=IX,y=IY,w=IW,h=IH;
    for(let i=0;i<7;i++){
      if(w>h){const sw=h/phi;squares.push({x,y,w:sw,h,idx:i});x+=sw;w-=sw;}
      else{const sh=w/phi;squares.push({x,y,w,h:sh,idx:i});y+=sh;h-=sh;}
      if(w<2||h<2)break;
    }
    squares.forEach((sq:any,i:number)=>{
      const alpha=[0.22,0.18,0.15,0.12,0.10,0.08,0.06][i]||0.05;
      ctx.fillStyle=`rgba(99,102,241,${alpha})`;ctx.fillRect(sq.x,sq.y,sq.w,sq.h);
      ctx.strokeStyle=`rgba(99,102,241,${alpha*3})`;ctx.lineWidth=0.75;
      ctx.strokeRect(sq.x+0.5,sq.y+0.5,sq.w-0.5,sq.h-0.5);
    });
    ctx.strokeStyle="rgba(250,204,21,0.6)";ctx.lineWidth=1.5;
    let ax=IX,ay=IY,aw=IW,ah=IH;
    const arcDir=[[0,1],[1,1],[1,0],[0,0]];
    for(let i=0;i<6;i++){
      const d=arcDir[i%4];
      const r=Math.min(aw,ah)/phi;
      const cx2=ax+d[0]*aw,cy2=ay+d[1]*ah;
      ctx.beginPath();
      if(aw>ah){ctx.arc(cx2,cy2,r,Math.PI*(d[0]?0:1),Math.PI*(d[0]?1:0),!d[0]);ax+=aw-r;aw=r;}
      else{ctx.arc(cx2,cy2,r,Math.PI*(d[1]?0.5:-0.5),Math.PI*(d[1]?-0.5:0.5),!d[1]);ay+=ah-r;ah=r;}
      ctx.stroke();
      if(Math.min(aw,ah)<3)break;
    }
    ctx.font="bold 14px Georgia,serif";ctx.fillStyle="rgba(250,204,21,0.6)";ctx.textAlign="center";ctx.textBaseline="middle";
    ctx.fillText("φ = 1.618",OX+PW/2,OY+PH-9);
    lbl(`${(IW/phi/sc).toFixed(0)}px main · ${((IW-IW/phi)/sc).toFixed(0)}px side`,OX+PW/2,OY+PH+13,"rgba(165,180,252,0.6)");
  }
  else if(system==="thirds"){
    const tw=IW/3,th=IH/3;
    for(let r=0;r<3;r++)for(let c=0;c<3;c++){
      ctx.fillStyle=(r+c)%2===0?"rgba(99,102,241,0.12)":"rgba(99,102,241,0.06)";
      ctx.fillRect(IX+c*tw,IY+r*th,tw,th);
    }
    ctx.strokeStyle="rgba(250,204,21,0.6)";ctx.lineWidth=0.9;
    for(let i=1;i<3;i++){
      ctx.beginPath();ctx.moveTo(IX+i*tw,IY);ctx.lineTo(IX+i*tw,IY+IH);ctx.stroke();
      ctx.beginPath();ctx.moveTo(IX,IY+i*th);ctx.lineTo(IX+IW,IY+i*th);ctx.stroke();
    }
    [[1,1],[1,2],[2,1],[2,2]].forEach(([c,r])=>{
      const px=IX+c*tw,py=IY+r*th;
      ctx.fillStyle="rgba(250,204,21,0.95)";ctx.beginPath();ctx.arc(px,py,5,0,Math.PI*2);ctx.fill();
      ctx.strokeStyle="rgba(250,204,21,0.4)";ctx.lineWidth=0.75;ctx.beginPath();ctx.arc(px,py,14,0,Math.PI*2);ctx.stroke();
    });
    arrH(IX,IY+IH+sc*3,IX+tw,IY+IH+sc*3,`${(tw/sc).toFixed(0)}px`);
  }
  else if(system==="radial"){
    const cx=OX+PW/2, cy=OY+PH/2;
    const maxR=Math.max(PW,PH)*0.6;
    const rings=params.rows||5, spokes=params.cols||12;
    for(let r=1;r<=rings;r++){
      const rad=maxR*(r/rings);
      ctx.strokeStyle=`rgba(99,102,241,${0.15+r*0.06})`;ctx.lineWidth=0.8;
      ctx.beginPath();ctx.arc(cx,cy,rad,0,Math.PI*2);ctx.stroke();
      ctx.fillStyle=`rgba(99,102,241,${0.03+r*0.01})`;
      ctx.beginPath();ctx.arc(cx,cy,rad,0,Math.PI*2);ctx.fill();
    }
    for(let s=0;s<spokes;s++){
      const angle=(s/spokes)*Math.PI*2-Math.PI/2;
      ctx.strokeStyle=`rgba(250,204,21,${s===0?0.7:0.25})`;ctx.lineWidth=s===0?1.2:0.6;
      ctx.beginPath();ctx.moveTo(cx,cy);
      ctx.lineTo(cx+Math.cos(angle)*maxR,cy+Math.sin(angle)*maxR);ctx.stroke();
      if(spokes<=16){
        const lx=cx+Math.cos(angle)*(maxR+10),ly=cy+Math.sin(angle)*(maxR+10);
        lbl(`${Math.round(s*(360/spokes))}°`,lx,ly,"rgba(250,204,21,0.5)",8);
      }
    }
    ctx.fillStyle="rgba(168,85,247,0.6)";ctx.beginPath();ctx.arc(cx,cy,6,0,Math.PI*2);ctx.fill();
    ctx.strokeStyle="rgba(168,85,247,0.4)";ctx.lineWidth=1;ctx.beginPath();ctx.arc(cx,cy,20,0,Math.PI*2);ctx.stroke();
    lbl("focal center",cx,cy-28,"rgba(216,180,254,0.9)");
    lbl(`${spokes} spokes · ${rings} rings`,OX+PW/2,OY+PH-8,"rgba(165,180,252,0.6)");
  }
  else if(system==="isometric"){
    const angleRad=30*Math.PI/180;
    const spacing=params.g*sc*2||32;
    ctx.strokeStyle="rgba(99,102,241,0.25)";ctx.lineWidth=0.6;
    for(let x=OX-PH;x<OX+PW+PH;x+=spacing){
      ctx.beginPath();ctx.moveTo(x,OY);ctx.lineTo(x+PH/Math.tan(Math.PI/2-angleRad),OY+PH);ctx.stroke();
    }
    for(let x=OX-PH;x<OX+PW+PH;x+=spacing){
      ctx.beginPath();ctx.moveTo(x,OY);ctx.lineTo(x-PH/Math.tan(Math.PI/2-angleRad),OY+PH);ctx.stroke();
    }
    ctx.strokeStyle="rgba(99,102,241,0.12)";
    for(let y=OY;y<OY+PH;y+=spacing*Math.sin(angleRad)*2){
      ctx.beginPath();ctx.moveTo(OX,y);ctx.lineTo(OX+PW,y);ctx.stroke();
    }
    const cx=OX+PW/2, cy=OY+PH/2, cs=Math.min(PW,PH)*0.18;
    const pts: any={t:[cx,cy-cs],r:[cx+cs*0.866,cy-cs*0.5],b:[cx,cy],l:[cx-cs*0.866,cy-cs*0.5]};
    ctx.fillStyle="rgba(168,85,247,0.3)";ctx.beginPath();ctx.moveTo(pts.t[0],pts.t[1]);ctx.lineTo(pts.r[0],pts.r[1]);ctx.lineTo(pts.b[0],pts.b[1]);ctx.lineTo(pts.l[0],pts.l[1]);ctx.closePath();ctx.fill();
    ctx.fillStyle="rgba(99,102,241,0.25)";ctx.beginPath();ctx.moveTo(pts.b[0],pts.b[1]);ctx.lineTo(pts.r[0],pts.r[1]);ctx.lineTo(pts.r[0],pts.r[1]+cs);ctx.lineTo(pts.b[0],pts.b[1]+cs);ctx.closePath();ctx.fill();
    ctx.fillStyle="rgba(99,102,241,0.15)";ctx.beginPath();ctx.moveTo(pts.b[0],pts.b[1]);ctx.lineTo(pts.l[0],pts.l[1]);ctx.lineTo(pts.l[0],pts.l[1]+cs);ctx.lineTo(pts.b[0],pts.b[1]+cs);ctx.closePath();ctx.fill();
    ctx.strokeStyle="rgba(168,85,247,0.8)";ctx.lineWidth=1.2;
    [[pts.t,pts.r],[pts.r,pts.b],[pts.b,pts.l],[pts.l,pts.t]].forEach(([a,b2]:[any,any])=>{ctx.beginPath();ctx.moveTo(a[0],a[1]);ctx.lineTo(b2[0],b2[1]);ctx.stroke();});
    lbl("isometric cube",cx,cy+cs+14,"rgba(216,180,254,0.8)");
    lbl("30° grid — flat elements with 3D depth",OX+PW/2,OY+PH-8,"rgba(165,180,252,0.6)");
  }
  else if(system==="diagonal"){
    const angle=params.angle||45;
    const rad=angle*Math.PI/180;
    const spacing=params.g*sc*2||28;
    ctx.strokeStyle="rgba(99,102,241,0.3)";ctx.lineWidth=0.7;
    const diagLen=Math.sqrt(PW*PW+PH*PH)*1.5;
    for(let d=-diagLen;d<diagLen*2;d+=spacing){
      ctx.beginPath();
      ctx.moveTo(OX+PW/2+Math.cos(rad)*d-Math.sin(rad)*diagLen/2,OY+PH/2+Math.sin(rad)*d+Math.cos(rad)*diagLen/2);
      ctx.lineTo(OX+PW/2+Math.cos(rad)*d+Math.sin(rad)*diagLen/2,OY+PH/2+Math.sin(rad)*d-Math.cos(rad)*diagLen/2);
      ctx.stroke();
    }
    ctx.strokeStyle="rgba(250,204,21,0.25)";ctx.lineWidth=0.4;
    const bRad=(angle+90)*Math.PI/180;
    for(let d=-diagLen;d<diagLen*2;d+=spacing*0.4){
      ctx.beginPath();
      ctx.moveTo(OX+PW/2+Math.cos(bRad)*d-Math.sin(bRad)*diagLen/2,OY+PH/2+Math.sin(bRad)*d+Math.cos(bRad)*diagLen/2);
      ctx.lineTo(OX+PW/2+Math.cos(bRad)*d+Math.sin(bRad)*diagLen/2,OY+PH/2+Math.sin(bRad)*d-Math.cos(bRad)*diagLen/2);
      ctx.stroke();
    }
    ctx.fillStyle="rgba(13,13,15,0.75)";
    ctx.fillRect(0,0,OX,CH);ctx.fillRect(OX+PW,0,CW-OX-PW,CH);
    ctx.fillRect(OX,0,PW,OY);ctx.fillRect(OX,OY+PH,PW,CH-OY-PH);
    lbl(`${angle}° diagonal grid — kinetic energy`,OX+PW/2,OY+PH-8,"rgba(250,204,21,0.6)");
  }
  else if(system==="compound"){
    const cols1=params.cols||3, cols2=params.rows||4;
    const cw1=(IW-g*(cols1-1))/cols1;
    const cw2=(IW-g*(cols2-1))/cols2;
    for(let c=0;c<cols1;c++){
      ctx.fillStyle="rgba(99,102,241,0.12)";ctx.fillRect(IX+c*(cw1+g),IY,cw1,IH);
      ctx.strokeStyle="rgba(99,102,241,0.5)";ctx.lineWidth=0.7;
      ctx.strokeRect(IX+c*(cw1+g)+0.5,IY+0.5,cw1-0.5,IH-0.5);
    }
    for(let c=0;c<cols2;c++){
      ctx.strokeStyle="rgba(244,63,94,0.5)";ctx.lineWidth=0.7;ctx.setLineDash([4,4]);
      ctx.strokeRect(IX+c*(cw2+g)+0.5,IY+0.5,cw2-0.5,IH-0.5);ctx.setLineDash([]);
    }
    [{c:"rgba(99,102,241,0.8)",l:`${cols1}-col grid`},{c:"rgba(244,63,94,0.8)",l:`${cols2}-col grid (dashed)`}].forEach(({c,l}:any,i:number)=>{
      ctx.fillStyle=c;ctx.fillRect(IX,OY+PH-28+i*12,20,8);
      lbl(l,IX+60,OY+PH-24+i*12,c,8.5);
    });
    lbl("compound grid — controlled chaos",OX+PW/2,OY+PH-8,"rgba(255,255,255,0.3)");
    arrH(IX,IY+IH+sc*3,IX+cw1,IY+IH+sc*3,`${(cw1/sc).toFixed(0)}px`,"rgba(99,102,241,0.7)");
    arrH(IX,IY+IH+sc*6,IX+cw2,IY+IH+sc*6,`${(cw2/sc).toFixed(0)}px`,"rgba(244,63,94,0.7)");
  }

  ctx.font="10px Inter,sans-serif";ctx.fillStyle="rgba(255,255,255,0.18)";ctx.textAlign="right";ctx.textBaseline="bottom";
  const fmt=FORMATS.find(f=>f.w===fmtW&&f.h===fmtH);
  ctx.fillText(`${fmt?.dw||fmtW+"px"} × ${fmt?.dh||fmtH+"px"}`,OX+PW-6,OY+PH-5);
}

function GridCalculator(){
  const [fmtId,setFmtId]=useState("a4");
  const [system,setSystem]=useState("swiss");
  const [landscape,setLandscape]=useState(false);
  const [params,setParams]=useState<Record<string,number>>({cols:4,rows:5,mt:50,mb:50,ml:40,mr:40,g:12,bl:18,angle:45,customW:800,customH:600});
  const canvasRef=useRef<HTMLCanvasElement>(null);

  const fmt=FORMATS.find(f=>f.id===fmtId)||FORMATS[0];
  const fmtW=fmtId==="custom"?params.customW:(landscape?fmt.h:fmt.w);
  const fmtH=fmtId==="custom"?params.customH:(landscape?fmt.w:fmt.h);

  function setP(k: string,v: number){setParams((p:any)=>({...p,[k]:v}));}

  useEffect(()=>{
    const presets: Record<string,any>={
      a4:{cols:4,rows:5,mt:50,mb:50,ml:40,mr:40,g:12,bl:18},
      a3:{cols:4,rows:6,mt:60,mb:60,ml:50,mr:50,g:14,bl:20},
      a5:{cols:3,rows:4,mt:35,mb:35,ml:28,mr:28,g:10,bl:16},
      letter:{cols:4,rows:5,mt:48,mb:48,ml:36,mr:36,g:12,bl:16},
      post18:{cols:5,rows:6,mt:80,mb:80,ml:60,mr:60,g:18,bl:22},
      post24:{cols:6,rows:8,mt:100,mb:100,ml:80,mr:80,g:20,bl:24},
      square:{cols:3,rows:3,mt:40,mb:40,ml:40,mr:40,g:16,bl:20},
      wide:{cols:6,rows:3,mt:60,mb:60,ml:80,mr:80,g:20,bl:20},
    };
    if(presets[fmtId])setParams((p:any)=>({...p,...presets[fmtId]}));
  },[fmtId]);

  useEffect(()=>{drawGrid(canvasRef.current,system,params,fmtW,fmtH);},[system,params,fmtId,landscape]);

  const IW=fmtW-params.ml-params.mr, IH=fmtH-params.mt-params.mb;
  const cols=Math.max(params.cols,1),rows=Math.max(params.rows,1);
  const colW=(IW-params.g*(cols-1))/cols;
  const rowH=(IH-params.g*(rows-1))/rows;

  const sys=GRID_SYSTEMS.find(g=>g.id===system)!;

  const controlDefs: Record<string,{k:string,l:string,mn:number,mx:number}[]>={
    swiss:[{k:"cols",l:"Columns",mn:1,mx:16},{k:"rows",l:"Rows",mn:1,mx:12},{k:"g",l:"Gutter (px)",mn:0,mx:60},{k:"ml",l:"Margin left",mn:0,mx:200},{k:"mr",l:"Margin right",mn:0,mx:200},{k:"mt",l:"Margin top",mn:0,mx:200},{k:"mb",l:"Margin bottom",mn:0,mx:200}],
    column:[{k:"cols",l:"Columns",mn:1,mx:16},{k:"g",l:"Gutter (px)",mn:0,mx:80},{k:"ml",l:"Margin left",mn:0,mx:200},{k:"mr",l:"Margin right",mn:0,mx:200},{k:"mt",l:"Margin top",mn:0,mx:200},{k:"mb",l:"Margin bottom",mn:0,mx:200}],
    baseline:[{k:"bl",l:"Baseline (px)",mn:6,mx:60},{k:"cols",l:"Columns",mn:1,mx:8},{k:"g",l:"Col gutter",mn:0,mx:60},{k:"ml",l:"Margin left",mn:0,mx:160},{k:"mr",l:"Margin right",mn:0,mx:160},{k:"mt",l:"Margin top",mn:0,mx:160},{k:"mb",l:"Margin bottom",mn:0,mx:160}],
    golden:[{k:"ml",l:"Margin left",mn:0,mx:200},{k:"mr",l:"Margin right",mn:0,mx:200},{k:"mt",l:"Margin top",mn:0,mx:200},{k:"mb",l:"Margin bottom",mn:0,mx:200}],
    thirds:[{k:"ml",l:"Margin left",mn:0,mx:160},{k:"mr",l:"Margin right",mn:0,mx:160},{k:"mt",l:"Margin top",mn:0,mx:160},{k:"mb",l:"Margin bottom",mn:0,mx:160}],
    radial:[{k:"cols",l:"Spokes",mn:4,mx:36},{k:"rows",l:"Rings",mn:2,mx:10}],
    isometric:[{k:"g",l:"Spacing",mn:8,mx:60}],
    diagonal:[{k:"angle",l:"Angle (°)",mn:15,mx:75},{k:"g",l:"Spacing",mn:6,mx:50}],
    compound:[{k:"cols",l:"Grid A cols",mn:2,mx:8},{k:"rows",l:"Grid B cols",mn:2,mx:8},{k:"g",l:"Gutter",mn:0,mx:40}],
  };

  const cats=["Editorial","Harmonic","Poster"];

  return(
    <div style={{display:"flex",gap:20,flexDirection:"column"}}>
      <div>
        <div style={{fontFamily:"var(--font-body)",fontSize:10,fontWeight:600,color:"var(--color-ink-muted)",letterSpacing:"0.08em",textTransform:"uppercase",marginBottom:10,marginTop:32}}>Format</div>
        <div style={{display:"flex",gap:6,flexWrap:"nowrap",overflowX:"auto",scrollbarWidth:"none"}}>
          {FORMATS.map(f=>(
            <button key={f.id} onClick={()=>setFmtId(f.id)} style={{padding:"6px 14px",borderRadius:"var(--radius-pill)",border:"none",cursor:"pointer",fontFamily:"var(--font-body)",fontSize:12,fontWeight:fmtId===f.id?500:400,background:fmtId===f.id?"var(--color-inverse-canvas)":"var(--color-surface-1)",color:fmtId===f.id?"var(--color-canvas)":"var(--color-ink-muted)",whiteSpace:"nowrap"}}>
              {f.label}
            </button>
          ))}
          <button onClick={()=>setLandscape((l:boolean)=>!l)} style={{background:"var(--color-surface-1)",color:"var(--color-ink)",borderRadius:"var(--radius-pill)",padding:"10px 18px",fontSize:13,fontWeight:500,border:"none",cursor:"pointer",fontFamily:"var(--font-body)",whiteSpace:"nowrap"}}>
            {landscape?"⬛":"⬜"} {landscape?"Land":"Port"}
          </button>
        </div>
        {fmtId==="custom"&&(
          <div style={{background:"var(--color-surface-1)",borderRadius:"var(--radius-xl)",border:"1px solid rgba(255,255,255,0.06)",padding:"24px",display:"flex",gap:12,marginTop:10}}>
            {[["customW","Width (px)"],["customH","Height (px)"]].map(([k,l])=>(
              <div key={k} style={{width:130}}>
                <label style={ss.label}>{l}</label>
                <input type="number" value={params[k]} min={100} max={5000} onChange={(e:any)=>setP(k,+e.target.value)} style={{...ss.input,fontFamily:"var(--font-mono)"}}/>
              </div>
            ))}
          </div>
        )}
      </div>

      {cats.map(cat=>{
        const sys2=GRID_SYSTEMS.filter(g=>g.cat===cat);
        return(
          <div key={cat}>
            <div style={{fontFamily:"var(--font-body)",fontSize:10,fontWeight:600,color:"var(--color-ink-muted)",letterSpacing:"0.08em",textTransform:"uppercase",marginBottom:10,marginTop:32}}>{cat} Grids</div>
            <div style={{display:"flex",gap:6,flexWrap:"nowrap",overflowX:"auto",scrollbarWidth:"none"}}>
              {sys2.map(g=>(
                <button key={g.id} onClick={()=>setSystem(g.id)} style={{display:"flex",alignItems:"center",gap:6,padding:"6px 14px",borderRadius:"var(--radius-pill)",border:"none",cursor:"pointer",fontFamily:"var(--font-body)",fontSize:12,fontWeight:system===g.id?500:400,background:system===g.id?"var(--color-inverse-canvas)":"var(--color-surface-1)",color:system===g.id?"var(--color-canvas)":"var(--color-ink-muted)",whiteSpace:"nowrap"}}>
                  <span style={{fontSize:14}}>{g.icon}</span>{g.label}
                </button>
              ))}
            </div>
          </div>
        );
      })}

      <div style={{background:"var(--color-surface-1)",borderRadius:"var(--radius-xl)",padding:24,border:"1px solid rgba(255,255,255,0.06)",display:"flex",gap:12,alignItems:"flex-start"}}>
        <span style={{fontSize:22,marginRight:12,flexShrink:0}}>{sys.icon}</span>
        <div>
          <div style={{fontFamily:"var(--font-body)",fontSize:13,fontWeight:600,color:T.ink,marginBottom:3}}>{sys.label}</div>
          <div style={{fontFamily:"var(--font-body)",fontSize:12,color:T.inkMuted,lineHeight:1.6}}>{sys.desc}</div>
        </div>
      </div>

      <div style={{background:"var(--color-canvas)",borderRadius:"var(--radius-xl)",overflow:"hidden",border:"1px solid rgba(255,255,255,0.06)",padding:12}}>
        <canvas ref={canvasRef} width={680} height={440} style={{width:"100%",height:"auto",display:"block",borderRadius:10}}/>
      </div>

      {["swiss","column","baseline"].includes(system)&&(
        <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:8}}>
          {[
            {l:"Column width",v:`${colW.toFixed(1)}px`},
            {l:"Row height",   v:`${rowH.toFixed(1)}px`},
            {l:"Inner area",   v:`${IW}×${IH}px`},
            {l:"Aspect ratio", v:`${(IW/IH).toFixed(3)}:1`},
          ].map((s:any)=>(
            <div key={s.l} style={{background:"var(--color-surface-1)",borderRadius:"var(--radius-lg)",padding:"11px 13px",border:"1px solid rgba(255,255,255,0.06)"}}>
              <div style={{fontFamily:"var(--font-body)",fontSize:9,color:"var(--color-ink-muted)",letterSpacing:"0.05em",textTransform:"uppercase",marginBottom:3}}>{s.l}</div>
              <div style={{fontFamily:"var(--font-mono)",fontSize:14,fontWeight:600,color:"var(--color-ink)"}}>{s.v}</div>
            </div>
          ))}
        </div>
      )}

      {(controlDefs[system]||[]).length>0&&(
        <div style={{background:"var(--color-surface-1)",borderRadius:"var(--radius-xl)",padding:24,border:"1px solid rgba(255,255,255,0.06)"}}>
          <div style={{fontFamily:"var(--font-body)",fontSize:10,fontWeight:600,color:"var(--color-ink-muted)",letterSpacing:"0.08em",textTransform:"uppercase",marginBottom:10}}>Parameters</div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(130px,1fr))",gap:16}}>
            {(controlDefs[system]||[]).map((c:any)=>(
              <div key={c.k}>
                <label style={ss.label}>{c.l} — <span style={{color:T.accentBlue,fontFamily:"var(--font-mono)"}}>{params[c.k]}</span></label>
                <input type="range" min={c.mn} max={c.mx} step={1} value={params[c.k]} onChange={(e:any)=>setP(c.k,+e.target.value)} style={{width:"100%",accentColor:T.accentBlue}}/>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Palette Studio wrapper ────────────────────────────────────────────────────
function PaletteStudioWrapper() {
  return <PaletteStudio />;
}

// ── Tool registry ─────────────────────────────────────────────────────────────
const TOOLS = [
  { id:"palette",  icon:"",   label:"Palette Studio",    comp:PaletteStudioWrapper },
  { id:"font",     icon:"Aa", label:"Font Pairing",      comp:FontPairing          },
  { id:"contrast", icon:"◑",  label:"Contrast Checker",  comp:ContrastChecker      },
  { id:"image",    icon:"↔",  label:"Image Converter",   comp:ImageConverter       },
  { id:"grid",     icon:"⊞",  label:"Grid Calculator",   comp:GridCalculator       },
  { id:"halftone", icon:"∷",  label:"Halftone",          comp:HalftoneStudio       },
  { id:"svg",      icon:"⬡",  label:"Image → SVG",       comp:SvgConverter         },
];

const SUBTITLES: Record<string,string> = {
  palette:  "Generate accessible OKLCH color palettes with WCAG + APCA contrast scoring and color blind simulation.",
  font:     "Infinite Google Font pairings — regenerate to explore, pick a strategy, compare by typographic score.",
  contrast: "WCAG AA/AAA live check. When failing, get harmonious color suggestions from color theory.",
  image:    "Convert, resize, and compress images client-side — private, instant, no upload needed.",
  grid:     "9 grid systems from Swiss Modular to Radial and Isometric — built for poster and print design.",
  halftone: "Convert images into halftone patterns — lines, dots, or squares. Adjust angle, spacing, contrast, brightness, and colors.",
  svg:      "Trace any image into a scalable SVG line drawing — adjust threshold, fill, invert, and edge dilation, then download.",
};

// ── Shell ─────────────────────────────────────────────────────────────────────
export default function DesignStudio() {
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();

  const isValidTab = (id: string | null | undefined): id is string =>
    !!id && TOOLS.some(t => t.id === id);

  // The URL query param is the source of truth for the active tab, so a refresh
  // or shared /design-studio?tab=grid link opens the right tool.
  const queryTab = searchParams.get('tab');
  const active = isValidTab(queryTab) ? queryTab : 'palette';

  const setActive = (id: string) => setSearchParams({ tab: id }, { replace: true });

  // DeepLinks via navigate('/design-studio', { state: { tab } }) still work —
  // on first load, promote a valid location.state tab into the query param.
  const stateTab = (location.state as { tab?: string } | null)?.tab;
  useEffect(() => {
    if (isValidTab(stateTab) && stateTab !== queryTab) {
      setSearchParams({ tab: stateTab }, { replace: true });
    }
    // Run once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const Tool = TOOLS.find(t => t.id === active)!.comp;
  return (
    <div style={{minHeight:"100vh",background:T.canvas,fontFamily:"var(--font-body)",color:T.ink,paddingTop:"56px"}}>
      <nav style={{display:"flex",gap:4,alignItems:"center",overflowX:"auto",scrollbarWidth:"none",padding:"8px 24px",borderBottom:`1px solid ${T.hairline}`,background:"var(--color-canvas)",position:"sticky",top:56,zIndex:90}}>
        {TOOLS.map(t=>(
          <button key={t.id} onClick={()=>setActive(t.id)} style={active===t.id
            ? {background:"var(--color-surface-2)",color:"var(--color-ink)",borderRadius:"var(--radius-pill)",padding:"6px 16px",fontSize:13,fontWeight:500,border:"none",cursor:"pointer",whiteSpace:"nowrap",fontFamily:"var(--font-body)",letterSpacing:"-0.1px"}
            : {background:"transparent",color:"var(--color-ink-muted)",borderRadius:"var(--radius-pill)",padding:"6px 16px",fontSize:13,fontWeight:400,border:"none",cursor:"pointer",whiteSpace:"nowrap",fontFamily:"var(--font-body)"}}>
            {t.label}
          </button>
        ))}
      </nav>
      <main style={{maxWidth:1440,margin:"0 auto",padding:"40px 48px 80px"}}>
        <div style={{marginBottom:40,paddingTop:8}}>
          <h1 style={{fontSize:48,fontWeight:600,letterSpacing:"-0.03em",lineHeight:1.0,color:"var(--color-ink)",fontFamily:"var(--font-display)",margin:"0 0 10px 0"}}>
            {TOOLS.find(t=>t.id===active)!.label}
          </h1>
          <p style={{fontSize:16,fontWeight:400,color:"var(--color-ink-muted)",lineHeight:1.5,letterSpacing:"-0.01em",margin:0,fontFamily:"var(--font-body)"}}>{SUBTITLES[active]}</p>
        </div>
        <Tool/>
      </main>
    </div>
  );
}
