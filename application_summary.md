# Student Management System — Application Summary

## Overview

A containerised Student Management System deployed on Google Kubernetes Engine (GKE).
It allows users to add, view, edit, and delete student records through a web interface.
The frontend and backend run as separate containers/pods and communicate over an internal Kubernetes network.
Deployments are managed via GitOps using ArgoCD — any manifest change pushed to GitHub is automatically deployed to the cluster.

---

## Current Versions

| Component | Version |
|---|---|
| Frontend | 1.3.0 |
| Backend | 1.3.0 |

---

## Technology Stack

| Layer | Technology | Details |
|---|---|---|
| Frontend | Angular 17 | Standalone components, TypeScript |
| Frontend server | nginx 1.27 (Alpine) | Serves static files, proxies API calls |
| Backend | Python 3.12 | Flask 3.0.3 REST API |
| Backend server | Gunicorn 22.0.0 | WSGI server, 1 worker |
| Storage | In-memory (Python dict) | Resets on pod restart — testing only |
| Container runtime | Docker | Multi-stage builds |
| Orchestration | Kubernetes (GKE) | Google Kubernetes Engine |
| Container registry | Google Container Registry (GCR) | gcr.io/emerald-water-452417-h1 |
| GitOps | ArgoCD | Auto-syncs from GitHub on manifest changes |
| Source control | GitHub | https://github.com/heshanperera95/student-management-gitops |
| Log collection | Fluentd | DaemonSet on GKE, ships logs to Elasticsearch |
| Log storage | Elasticsearch 8.x | 2-node HA cluster on GCP VMs (server1 + server2) |
| Log visualization | Kibana 8.x | Hosted on server1, secured with authentication |
| Metrics collection | Prometheus | kube-prometheus-stack via Helm |
| Metrics visualization | Grafana | kube-prometheus-stack via Helm |

---

## Project Structure

```
gke cluster/
├── backend/
│   ├── app.py                  ← Flask REST API + Prometheus metrics
│   ├── requirements.txt        ← Python dependencies
│   ├── Dockerfile              ← Python 3.12-slim + Gunicorn
│   └── .dockerignore
├── frontend/
│   ├── src/
│   │   ├── app/
│   │   │   ├── models/student.model.ts
│   │   │   ├── services/
│   │   │   │   ├── student.service.ts
│   │   │   │   └── version.service.ts
│   │   │   ├── components/
│   │   │   │   ├── student-form/   ← Add / Edit form
│   │   │   │   ├── student-list/   ← Records table with Load button
│   │   │   │   └── footer/         ← Displays version info
│   │   │   ├── app.component.*
│   │   │   ├── app.config.ts
│   │   │   └── version.ts          ← FRONTEND_VERSION constant
│   │   ├── main.ts
│   │   ├── index.html
│   │   └── styles.css
│   ├── nginx.conf              ← Reverse proxy config
│   ├── angular.json
│   ├── package.json
│   ├── tsconfig.json
│   ├── Dockerfile              ← Node 20 build + nginx 1.27 serve
│   └── .dockerignore
├── k8s_manifests/              ← Watched by ArgoCD
│   ├── namespace.yaml
│   ├── backend-deployment.yaml
│   ├── backend-service.yaml
│   ├── backend-servicemonitor.yaml ← Prometheus scrape config
│   ├── frontend-deployment.yaml
│   ├── frontend-service.yaml
│   ├── fluentd-configmap.yaml
│   ├── fluentd-daemonset.yaml
│   └── elasticsearch-tiebreaker.yaml
├── docker-compose.yml          ← Local development setup
├── argocd-app.yaml             ← ArgoCD Application definition
├── EFK_Setup.md                ← EFK stack detailed documentation
├── EFK_Setup_Summary.md        ← EFK stack summary
├── todo.md                     ← Pending work items
└── application_summary.md      ← This file
```

---

## Backend API

**Base URL (local):** `http://localhost:5000`
**Base URL (GKE, internal):** `http://backend-service:5000`

| Method | Endpoint | Description | Request Body | Response |
|---|---|---|---|---|
| GET | `/health` | Health check | — | `{"status": "healthy"}` |
| GET | `/version` | Backend version | — | `{"version": "1.3.0"}` |
| GET | `/metrics` | Prometheus metrics | — | Prometheus text format |
| GET | `/students` | Get all students | — | Array of student objects |
| GET | `/students/:id` | Get one student | — | Student object or 404 |
| POST | `/students` | Create a student | `{id, name, email, phone}` | Created student or 400/409 |
| PUT | `/students/:id` | Update a student | `{name, email, phone}` | Updated student or 404 |
| DELETE | `/students/:id` | Delete a student | — | `{"message": "..."}` or 404 |

### Student Object Schema

```json
{
  "id":    "S001",
  "name":  "John Doe",
  "email": "john@example.com",
  "phone": "+94771234567"
}
```

---

## Frontend → Backend Connectivity

```
Browser
  │
  │  HTTP request to /api/*
  ▼
nginx (inside frontend container, port 80)
  │
  │  Strips /api/ prefix, proxies to backend-service:5000
  ▼
backend-service (Kubernetes ClusterIP Service, port 5000)
  │
  ▼
backend Pod (Flask/Gunicorn, port 5000)
```

---

## Kubernetes Resources

### Namespace

| Field | Value |
|---|---|
| Name | `student-management` |

### Backend Deployment

| Field | Value |
|---|---|
| Name | `backend` |
| Image | `gcr.io/emerald-water-452417-h1/student-backend:1.3.0` |
| Replicas | 1 |
| Container port | 5000 |
| CPU request/limit | 100m / 300m |
| Memory request/limit | 128Mi / 256Mi |
| Liveness probe | `GET /health` every 15s |
| Readiness probe | `GET /health` every 10s |
| Metrics | `GET /metrics` — scraped by Prometheus every 15s |

### Backend Service

| Field | Value |
|---|---|
| Name | `backend-service` |
| Type | `ClusterIP` (internal only) |
| Port | 5000 (named: `http`) |

### Frontend Deployment

| Field | Value |
|---|---|
| Name | `frontend` |
| Image | `gcr.io/emerald-water-452417-h1/student-frontend:1.3.0` |
| Replicas | 2 |
| Container port | 80 |
| CPU request/limit | 50m / 200m |
| Memory request/limit | 64Mi / 128Mi |

### Frontend Service

| Field | Value |
|---|---|
| Name | `frontend-service` |
| Type | `LoadBalancer` (public, stable IP) |
| Port | 80 |
| External IP | **35.255.191.121** |

---

## GKE Cluster Details

| Field | Value |
|---|---|
| Cluster name | `my-gke-cluster` |
| GCP Project ID | `emerald-water-452417-h1` |
| Region / Zone | `us-central1-a` |
| Node pool | `standard-pool` |
| Nodes | 2 x `e2-custom-4-8192` (4 vCPU, 8GB RAM each) |
| Kubernetes version | v1.35.5-gke.1000000 |
| Kubernetes context | `gke_emerald-water-452417-h1_us-central1-a_my-gke-cluster` |
| Container Registry | `gcr.io/emerald-water-452417-h1` |
| Node 1 external IP | 34.72.169.238 |
| Node 2 external IP | 34.134.166.234 |

> **Note:** Node external IPs change when GKE auto-upgrades the cluster (nodes are replaced). LoadBalancer IPs are stable. NodePort services must use updated node IPs after an upgrade.

---

## Access URLs

| Service | URL | Notes |
|---|---|---|
| Student App | `http://35.255.191.121` | Stable LoadBalancer IP |
| ArgoCD | `https://34.72.169.238:31762` | NodePort — IP changes on node upgrade |
| Grafana | `http://34.72.169.238:32000` | NodePort — IP changes on node upgrade |
| Prometheus | `http://34.72.169.238:32001` | NodePort — IP changes on node upgrade |
| Kibana | `http://34.170.121.101:5601` | VM static IP — stable |

---

## ArgoCD

| Field | Value |
|---|---|
| Namespace | `argocd` |
| Version | v3.4.2 |
| UI Access | `https://34.72.169.238:31762` |
| Username | `admin` |
| Application name | `student-management` |
| Watched repo | `https://github.com/heshanperera95/student-management-gitops.git` |
| Watched path | `k8s_manifests/` |
| Watched branch | `main` |
| Sync policy | Automated (prune + selfHeal enabled) |

---

## EFK Logging Stack

| Field | Value |
|---|---|
| Elasticsearch | 3-node HA cluster — es-node-1 (server1), es-node-2 (server2), es-tiebreaker (GKE pod) |
| Kibana | `http://34.170.121.101:5601` — username: `elastic` |
| Fluentd | DaemonSet in kube-system, ships to both ES nodes |
| Log index | `student-management-YYYY.MM.DD` |
| Full docs | See `EFK_Setup.md` and `EFK_Setup_Summary.md` |

---

## Prometheus / Grafana

| Field | Value |
|---|---|
| Install method | Helm — `kube-prometheus-stack` chart |
| Namespace | `monitoring` |
| Prometheus UI | `http://34.72.169.238:32001` |
| Grafana UI | `http://34.72.169.238:32000` |
| Grafana username | `admin` |
| Scrape target | `student-management` namespace via ServiceMonitor |
| Scrape interval | 15s |
| Backend metrics | `GET /metrics` — request rate, latency, error rate |

---

## Local Development

```bash
# Start both containers
docker compose up --build

# Frontend available at
http://localhost:8080

# Backend API available at
http://localhost:5000
```

---

## Versioning

- **Frontend version** — `frontend/src/app/version.ts` → `FRONTEND_VERSION`
- **Backend version** — `backend/app.py` → `VERSION`
- Both displayed in the footer — frontend baked at build time, backend fetched live from `GET /api/version`
- Bump the constant, rebuild image, update manifest tag, push to GitHub → ArgoCD deploys

---

## GitOps Deployment Flow

```
1. Make code change
2. Bump version constant
3. docker build -t gcr.io/emerald-water-452417-h1/IMAGE:VERSION ./SERVICE
4. docker push gcr.io/emerald-water-452417-h1/IMAGE:VERSION
5. Update image tag in k8s_manifests/
6. git commit + push to GitHub
7. ArgoCD detects change → rolling deploy (no kubectl needed)
```

### After a backend change

```bash
docker build -t gcr.io/emerald-water-452417-h1/student-backend:VERSION ./backend
docker push gcr.io/emerald-water-452417-h1/student-backend:VERSION
# Edit k8s_manifests/backend-deployment.yaml — update image tag
git add k8s_manifests/backend-deployment.yaml
git commit -m "deploy backend vVERSION"
git push
```

### After a frontend change

```bash
docker build -t gcr.io/emerald-water-452417-h1/student-frontend:VERSION ./frontend
docker push gcr.io/emerald-water-452417-h1/student-frontend:VERSION
# Edit k8s_manifests/frontend-deployment.yaml — update image tag
git add k8s_manifests/frontend-deployment.yaml
git commit -m "deploy frontend vVERSION"
git push
```

### After GKE node upgrade (node IPs change)

NodePort service URLs must be updated. Get new node IPs:
```bash
kubectl get nodes -o wide
```
Update ArgoCD, Grafana, and Prometheus URLs using the new external IPs with the same NodePorts (31762, 32000, 32001).
