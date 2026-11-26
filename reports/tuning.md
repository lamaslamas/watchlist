# Ricerca pesi (leave-one-out)

Titoli votati: 448. Base voto medio: 7.24. Sets valutati: 75030. Spearman train = 70% titoli (usato per scegliere), test = 30% mai usato.

| set | λ | k | peso T | ripidezza | Spearman tutti | train | test | voto medio top 50 |
|---|---|---|---|---|---|---|---|---|
| attuale | 0.4 | 3 | 0.65 | 1 | 0.553 | 0.526 | 0.605 | 8.64 |
| A (max Spearman) | 0.4 | 1 | 0.4 | 0.62 | 0.699 | 0.701 | 0.692 | 8.80 |
| B (max top 50) | 0.4 | 3 | 0.432 | 0.54 | 0.698 | 0.697 | 0.699 | 8.90 |
| C (T ≥ 0.60) | 1.5 | 3 | 0.609 | 0.52 | 0.664 | 0.667 | 0.647 | 8.82 |

## Pesi delle componenti

| set | genres | directors | cast | countries | decade | keywords |
|---|---|---|---|---|---|---|
| attuale | 0.20 | 0.30 | 0.15 | 0.15 | 0.10 | 0.10 |
| A | 0.29 | 0.04 | 0.17 | 0.00 | 0.25 | 0.25 |
| B | 0.37 | 0.03 | 0.13 | 0.00 | 0.38 | 0.09 |
| C | 0.13 | 0.13 | 0.17 | 0.00 | 0.14 | 0.42 |

Correlazione del solo paese (LOO): A -0.173, B -0.162 (azzerato), C -0.174 (azzerato)

## Top 20 watchlist

| # | attuale | A | B | C |
|---|---|---|---|---|
| 1 | Rebecca - La prima moglie (1940) | Vivere (1952) | Vivere (1952) | Vivere (1952) |
| 2 | Roma (1972) | Cosmos - Odissea nello spazio (2014) | Persona (1966) | Roma (1972) |
| 3 | Frenzy (1972) | Persona (1966) | Cosmos - Odissea nello spazio (2014) | Rebecca - La prima moglie (1940) |
| 4 | Lettere da Iwo Jima (2006) | La battaglia di Hacksaw Ridge (2016) | La battaglia di Hacksaw Ridge (2016) | Cosmos - Odissea nello spazio (2014) |
| 5 | Il boom (1963) | The Help (2011) | Viaggio a Tokyo (1953) | Lettere da Iwo Jima (2006) |
| 6 | Shutter Island (2010) | Shutter Island (2010) | Va' e vedi (1985) | Shutter Island (2010) |
| 7 | Il giudizio universale (1961) | Va' e vedi (1985) | The Help (2011) | Persona (1966) |
| 8 | L'uomo nel mirino (1977) | Rebecca - La prima moglie (1940) | Nick mano fredda (1967) | I figli della violenza (1950) |
| 9 | Il mio viaggio in Italia (1999) | Viaggio a Tokyo (1953) | Rebecca - La prima moglie (1940) | La battaglia di Hacksaw Ridge (2016) |
| 10 | Flags of Our Fathers (2006) | Stalker (1979) | Shutter Island (2010) | Va' e vedi (1985) |
| 11 | Changeling (2008) | Nick mano fredda (1967) | L'infanzia di Ivan (1962) | Il boom (1963) |
| 12 | Vivere (1952) | The IT Crowd (2006) | Quel pomeriggio di un giorno da cani (1975) | The Help (2011) |
| 13 | I figli della violenza (1950) | I figli della violenza (1950) | Stalker (1979) | Platoon (1986) |
| 14 | Il generale Della Rovere (1959) | Quel pomeriggio di un giorno da cani (1975) | I figli della violenza (1950) | Wall Street (1987) |
| 15 | Wall Street (1987) | L'infanzia di Ivan (1962) | La donna che canta (2010) | Il primo re (2019) |
| 16 | Mulholland Drive (2001) | L'ultima missione: Project Hail Mary (2026) | Il giorno più lungo (1962) | Calvario (2014) |
| 17 | Un eroe dei nostri tempi (1955) | The Prestige (2006) | The Prestige (2006) | L'infanzia di Ivan (1962) |
| 18 | Persona (1966) | Platoon (1986) | Corvo Rosso non avrai il mio scalpo (1972) | Tombstone (1993) |
| 19 | Broadway Danny Rose (1984) | La donna che canta (2010) | The IT Crowd (2006) | Nick mano fredda (1967) |
| 20 | Lo scopone scientifico (1972) | Erased (2016) | Erased (2016) | Contact (1997) |
