# BacktoBlack

BacktoBlack is a debt payoff and budgeting companion that pairs a Strategy Lab for comparing payoff methods with a paycheck-aware Budget planner. It runs on a React + Vite front end and an Express + SQLite API.

## Features
- Strategy Lab to simulate Avalanche, Snowball, and custom payoff strategies, then send a saved schedule to Budget.
- Budget and paycheque planner with minimums, extra payments, and saved schedules.
- Tracking for liabilities, expenses, income, and assets with quick summaries on the dashboard.
- Charts and projections powered by Recharts for payoff timelines.

## Screenshots
- TODO: add screenshots or GIFs here.

## Tech Stack
- Frontend: React 19, TypeScript, Vite, Tailwind/PostCSS, React Router, Recharts, Lucide icons.
- Backend: Express (TypeScript) with SQLite storage.
- Tooling: ts-node, concurrently for dev orchestration, Docker + Compose for containerized runs.

## Getting Started

### Prerequisites
- Node.js 18+ and npm.
- Optional: Docker and Docker Compose.

### Installation
```bash
npm install
```
If you need environment variables, create a `.env` file (see the existing `.env` for shape/values).

### Development
Start the API and Vite dev server together:
```bash
npm run dev
```
Or run just the API:
```bash
npm run start:server
```

### Production Build
```bash
npm run build
```
Preview the production bundle locally:
```bash
npm run preview
```

#### Docker / Compose
```bash
docker compose up --build
```
- Serves the app on `http://localhost:7175` (nginx proxies the API at `/api`).
Stop containers:
```bash
docker compose down
```

## Available Scripts
- `npm run dev` — run API and Vite together for local dev.
- `npm run start:server` — run the Express API only.
- `npm run build` — build the frontend for production.
- `npm run preview` — serve the built frontend locally.
- `npm run db:init` — initialize the SQLite database.

## API Overview
- The Express server lives in `server/server.ts` (TypeScript). Endpoints are proxied under `/api` when using Docker/nginx.
- TODO: add endpoint list and request/response examples.

## Contributing
Pull requests and issues are welcome. Please open an issue first if you plan a large change.

## License
This project is released under the [MIT License](LICENSE).
