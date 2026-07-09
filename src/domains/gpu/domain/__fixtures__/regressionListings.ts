// Kuratierter Regressionskorpus realistisch geformter, problembehafteter
// Listing-Titel: Umlaute, gemischte Sprachen, HTML-Entities, Accessory-/System-
// Faelle. Tests pruefen hier nur strukturelle Invarianten (kein Crash, Health
// definiert), keine exakten Match-Erwartungen.
// ponytail: synthetisch statt Live-eBay-Fetch (braucht Credentials, nicht im
// Testlauf verfuegbar) — erweitern, sobald echte Fehlmatches auftauchen.
export const regressionListingTitles: string[] = [
  'RTX 3070 &amp; Zubehör, defekt – kein Bild',
  'Grafikkarte GTX 1080 Ti (läuft einwandfrei) OVP',
  'ASUS ROG Strix RTX&nbsp;3080 10GB gebraucht',
  'MSI RTX3060Ti 8GB – für Bastler / for parts only',
  'EVGA RTX 3090 FTW3 – Wasserschaden, verschmort',
  'Nvidia RTX 4090 24GB neu &lt;versiegelt&gt;',
  'Palit RTX 2070 Super — Lüfter defekt, sonst top',
  'Zotac GTX 1660 SUPER 6GB günstig abzugeben',
  'RTX 3070Ti Founders Edition kühlerlos ohne Kühler',
  'Sapphire RX 6800 XT NITRO+ 16GB läuft, kleiner Kratzer',
  'Tragetasche für Grafikkarte RTX 4090 3090 wasserdicht',
  'Gaming PC mit RTX 3060 12GB Ryzen 5 5600 16GB RAM',
  'GPU water block EKWB für RTX 3080 – nur Kühler',
  'GeForce RTX 3050 8 GB – ungetestet, unknown fault',
  'RTX™ 3090 Ti STRIX – artefakte unter last',
  'AMD Radeon RX 580 8GB — mining karte, treiberabstürze',
  'INNO3D RTX 4070 Ti  SUPER   16GB  (mehrfach Leerzeichen)',
  '12VHPWR Adapterkabel für RTX 4000 Serie 16pin',
  'RTX 3080 défectueux carte graphique pièces',
  'scheda video RTX 2060 6GB funzionante usata',
  'RTX 4060 Ti 16GB Rechnung & Garantie, wie neu',
  'GTX 980 Ti reballed reflow Reparaturversuch',
  'Leerkarton / empty box only RTX 4090 – KEINE Karte',
  'RTX A4000 Workstation Precision 3660 CAD workstation',
];
