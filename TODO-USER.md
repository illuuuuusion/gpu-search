# Was du noch tun musst, damit die neuen Features (C1, C2, D, B2, B6, B4) laufen

Der Code ist umgesetzt, gebaut (`npm run lint` grün) und getestet (`npm test`, 73/73 grün).
A6 wurde bewusst **nicht** umgesetzt (toter Liquipedia-Client bleibt ignoriert, wie besprochen).

Alle neuen Features haben Feature-Flags und sind per Default an – **außer B4** (Kleinanzeigen), das
aus gutem Grund aus ist. Reihenfolge nach Aufwand für dich.

---

## 1. Discord-Reactions global aktivieren (Voraussetzung für C1, C2, D)
`REACTIONS_ENABLED=false` ist weiterhin der Default. Ohne das passiert bei 👍/👎/🚫/⏰/🔥/🧊 **nichts**.
- [ ] In `.env` `REACTIONS_ENABLED=true` setzen.
- [ ] Discord Developer Portal: der Bot braucht den (unprivilegierten) **Message-Reactions**-Intent –
      der wird rein per Code aktiviert, keine gesonderte Freischaltung nötig. Message Content Intent
      ist bei euch schon an.
- [ ] Testen: mit einem Account aus `ALLOWED_ADMIN_IDS`/`ALLOWED_REACTOR_IDS` auf einen Alert reagieren.
      Reaktionen fremder Nutzer werden still ignoriert (so gewollt).

## 2. C2 – Fehltreffer melden testen
- [ ] 🚫 auf einen falschen Alert → Bot fragt nach dem Ausschlussbegriff → innerhalb 2 Min. antworten.
- [ ] Prüfen, dass ein Begriff, der einem echten Alias zu nahe kommt, abgelehnt wird
      (z. B. „3070Ti“ bei aktivem RTX-3070-Ti-Profil), ein spezifischer Begriff dagegen durchgeht.
- [ ] Kalibrierung ist **permissiv** (`EXCLUSION_SIMILARITY_MAX_DISTANCE=2`). Falls zu viele legitime
      Begriffe durchrutschen: Wert senken. Falsch geblockte per `/exclusions review` + `/exclusions undo <id>`.
- Ausschlüsse gelten **pro Profil** und landen in `data/runtime-exclusions.json`.

## 3. C1 – Dream-Deal-Score justieren
- [ ] Startschwelle ist `DREAM_DEAL_MIN_SCORE=15` (Deal-Score/Preis-Headroom in %). Nur **WORKING**-Listings.
- [ ] Ein paar Tage laufen lassen, dann per 🔥 (mehr Dream Deals) / 🧊 (weniger) nachjustieren.
      Jede Anpassung ist im Audit-Log im State (`dreamDealBias[].auditLog`) nachvollziehbar.
- [ ] Falls die Gewichtung (Preis vor Feedback) sich in der Praxis falsch anfühlt: sag Bescheid,
      die Konstanten in `src/domains/gpu/domain/dreamDealScore.ts` sind der Stellhebel.

## 4. D – Auktions-Reminder testen
- [ ] ⏰ auf einen **Auktions**-Alert (nicht Sofort-Kauf) → Reminder wird 20 Min vor Ende geplant
      (`AUCTION_REMINDER_LEAD_MINUTES=20`, gemeinsam pro Listing).
- [ ] Der Reminder ruft kurz vor Ende den frischen Preis ab. **Hinweis:** der Preis kommt aus der
      eBay-Browse-Item-API; verifiziere bei einer echten Auktion, dass `currentPriceEur` sinnvoll gefüllt
      ist (im Mock ist er fix 123,45 €). Reminder überleben Neustarts (im State persistiert).

## 5. B2 – Deal-Timing
- [ ] Braucht **eigene Historie**: erst nach ein paar Wochen Beobachtungen (mind.
      `DEAL_TIMING_MIN_SAMPLES=4` pro Profil+Zustand) erscheint die „Jetzt kaufen / Abwarten“-Zeile.
      Am Anfang bleibt sie leer – das ist korrekt, kein Fehler.
- Kein eBay-Marketplace-Insights-Zugriff nötig (wie entschieden auf ObservationRecord-Historie umgesetzt).

## 6. B6 – Alias-Fallback (nur Logging)
- [ ] **Bewusst regelbasiert statt Embedding-Modell umgesetzt** (kein `@xenova/transformers`, kein
      Modell-Download, keine neue Dependency). Grund: Ziel war „Near-Miss loggen, nicht alarmieren“,
      und es gab keine konkreten verpassten Beispiele – ein 25-MB-Modell dafür wäre Overkill.
- [ ] Beobachte `data/alias-fallback-log.json`. Tauchen dort echte, klar zuordenbare Treffer auf, die der
      reguläre Matcher verpasst? → dann entweder Alias ergänzen, oder mir sagen „bau doch das Embedding-Modell“.
      Die Funktion `findAliasFallback` hat dieselbe Signatur, ist also 1:1 austauschbar.
- [ ] Ggf. `ALIAS_FALLBACK_MIN_SIMILARITY=0.72` justieren (höher = strenger, weniger Log-Rauschen).

## 7. B4 – Cross-Marketplace-Arbitrage (Kleinanzeigen) — **Handarbeit nötig**
Das ist der einzige Punkt, der ohne deine Mitarbeit **nicht produktiv laufen kann**:
- [ ] **Rechtlich/ToS klären:** Kleinanzeigen hat keine offizielle API. Der Adapter ist HTML-Scraping in
      einer Grauzone. Entscheide, ob ihr das wollt/dürft, bevor ihr `KLEINANZEIGEN_ENABLED=true` setzt.
- [ ] **Scraper-Selektoren verifizieren:** `parseSearchResults` in
      `src/domains/gpu/infrastructure/kleinanzeigen/client.ts` konnte hier **nicht** gegen die Live-Seite
      getestet werden. Die Regex-Selektoren (`article.aditem`, Preis-Klasse, `/s-anzeige/`-Link) müssen
      gegen echtes HTML geprüft/nachgezogen werden. Solange sie nicht matchen, kommt eine Warnung ins Log
      und es passiert nichts (kein Crash).
- [ ] Margen-Parameter prüfen: `ARBITRAGE_MIN_MARGIN_EUR=40`, `ARBITRAGE_RESELL_FEE_PERCENT=12`,
      `ARBITRAGE_RESELL_SHIPPING_EUR=8`. Wiederverkaufswert = Ø funktionierender eBay-Preis aus eurer Historie
      (also erst sinnvoll, wenn B2/Historie Daten hat).
- [ ] Erst dann `KLEINANZEIGEN_ENABLED=true`.

---

## Allgemein
- [ ] `.env` aus `.env.example` aktualisieren (alle neuen Variablen sind dort dokumentiert).
- [ ] `data/` wird nicht versioniert (wie besprochen) – neue Dateien `runtime-exclusions.json`,
      `alias-fallback-log.json` sowie `*.bak.*` liegen dort und brauchen nichts weiter von dir.
- [ ] Für den echten Betrieb wie gehabt `NOTIFIER_PROVIDER=discord`, `EBAY_PROVIDER=live` + Credentials.
