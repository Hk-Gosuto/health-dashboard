# Apple Health Dashboard

A privacy-first, client-side dashboard for visualizing your Apple Health (and optional Garmin) export. Drop the unzipped folder, get interactive charts. Nothing leaves your browser.

## How it works

1. On iPhone: **Settings → Health → Export All Health Data**
2. Unzip the export to a folder
3. Open the dashboard and select that folder
4. Browse your data across 18 tabs grouped into 5 sections

Optional: select a Garmin Connect export folder instead — the dashboard parses Garmin's `DI_CONNECT/*.json` for training-readiness, ATL/CTL, race predictions, fitness age, and more.

## Tabs

### Dashboard
| Tab | What it shows |
|-----|---------------|
| **Overview** | At-a-Glance tiles with sparklines, week/month charts, **Trends** (multi-window: 7d / 14d / 30d, sparkline-per-window), **AI Insights** (inline) |
| **Score** | Composite health score 0–100 with sub-component breakdown |

### Health
| Tab | What it shows |
|-----|---------------|
| **Cardio** | VO2 Max + fitness age, Resting HR & HRV overlay, Walking HR, HR Recovery, HR Range band, Cardiac Efficiency |
| **Body** | Weight + Lean Mass, Body Fat %, BMI |
| **Sleep** | Stage stack, latency, WASO, consistency, sleep timing, temperature, breathing disturbances, SpO2 |
| **Cycle** | Cycle length, period duration, flow distribution, basal body temperature |
| **Daylight** | Daily exposure, seasonal pattern, year-over-year monthly average |
| **Audio** | Headphone & environmental noise vs WHO safe thresholds |

### Fitness
| Tab | What it shows |
|-----|---------------|
| **Mobility** | Walking speed, step length, double-support, asymmetry, flights climbed, stair speed, steadiness, 6-min walk |
| **Running** | Power, pace, stride length, vertical oscillation, ground contact time, form overview |
| **Training** | Garmin readiness, VO2, performance scores, ATL/CTL, race predictions, stress, sleep scores, fitness age, heat & altitude, hydration |
| **Training Load** | Fitness/Fatigue/Form (CTL/ATL/TSB), weekly load |

### Activities
| Tab | What it shows |
|-----|---------------|
| **Calendar** | GitHub-style heatmap, metric-selectable, per year |
| **Trainings** | Workout type breakdown + per-session detail (GPS route, HR, pace, elevation, splits) |
| **Compare** | Auto-detected repeated routes — pace/speed progression overlaid |
| **Heatmap** | All GPS routes on one map with frequency coloring |

### Trends & Analysis
| Tab | What it shows |
|-----|---------------|
| **Correlations** | Scatter plots with Pearson r, rolling correlation strength |
| **Yearly** | Year-over-year comparison table with % changes |

## Technical highlights

- **1GB+ XML parsed in-browser** via a Web Worker with 64MB streaming chunks and regex extraction — no DOM parser
- **Apple-Health-specific date parser** — Safari's `Date` constructor rejects `"YYYY-MM-DD HH:mm:ss ±ZZZZ"`; we parse it manually so HR timelines and sleep stage timing work cross-browser
- **Source deduplication** — iPhone + Apple Watch step/distance/energy records deduplicated by max-per-source-per-day; Watch sleep stages preferred over iPhone's `AsleepUnspecified`
- **Multi-window trend detection** — for each curated metric, compares avg(last N) vs avg(prior N) across 7/14/30-day windows with shared y-scale sparklines
- **IndexedDB cache** — parsed data persisted client-side so reloads are instant
- **Lazy loading** — each tab is code-split; Recharts and Leaflet in separate chunks
- **Optional Garmin source** — same dashboard, parses Garmin Connect JSON exports for richer training metrics
- **Privacy** — zero network requests for your data. All parsing, analysis, and rendering happens locally.

## Stack

- React 19 + TypeScript 5
- Vite 8
- Recharts (charts)
- Leaflet + react-leaflet (maps)
- Tailwind CSS v4
- Lucide React (icons)

## Development

```bash
npm install
npm run dev      # localhost:5173
npm run build    # static dist/
npm run lint
```

## Local AI Provider

AI features can use either an OpenRouter API key in the browser or a local ChatGPT/Codex OAuth proxy.

```bash
npm run ai:login   # sign in with ChatGPT/Codex OAuth using a browser device code
npm run ai:server  # starts http://127.0.0.1:8787
npm run ai:status  # checks local auth status
```

When the local AI server is running and authenticated, the dashboard hides the OpenRouter API key input and sends AI requests to the local server. OAuth tokens are stored on this machine under `~/.health-dashboard/ai-auth.json`; the browser never receives them.

Optional environment variables:

```bash
HEALTH_DASHBOARD_AI_PORT=8787
HEALTH_DASHBOARD_AI_MODEL=gpt-5.5
VITE_LOCAL_AI_BASE=http://127.0.0.1:8787
```

## Data format

Parses Apple Health's `export.xml` (or localized variants like `exportacion.xml`). HealthKit identifiers are language-independent API constants, so any export language works.

Also reads:
- `electrocardiograms/*.csv` — ECG waveform data at 512Hz (used by `TrainingViewer` when present)
- `workout-routes/*.gpx` — GPS tracks with speed and elevation

For Garmin Connect: select an unzipped Garmin export folder containing `DI_CONNECT/`. The parser reads training readiness, VO2 Max, endurance/hill scores, ATL/CTL, race predictions, heat & altitude acclimation, fitness age, daily stress, hydration, and sleep scores.

## License

MIT
