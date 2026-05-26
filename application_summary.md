# Student Management System — Application Summary

## Overview

A containerised Student Management System deployed on Google Kubernetes Engine (GKE).
It allows users to add, view, edit, and delete student records through a web interface.
The frontend and backend run as separate containers/pods and communicate over an internal Kubernetes network.

---

## Current Versions

| Component | Version |
|---|---|
| Frontend | 1.1.0 |
| Backend | 1.1.0 |

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

---

## Project Structure

```
gke cluster/
├── backend/
│   ├── app.py                  ← Flask REST API
│   ├── requirements.txt        ← Python dependencies
│   ├── Dockerfile              ← Python 3.12-slim + Gunicorn
│   └── .dockerignore
├── frontend/
│   ├── src/
│   │   ├── app/
│   │   │   ├── models/
│   │   │   │   └── student.model.ts
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
├── k8s_manifests/
│   ├── namespace.yaml
│   ├── backend-deployment.yaml
│   ├── backend-service.yaml
│   ├── frontend-deployment.yaml
│   └── frontend-service.yaml
├── docker-compose.yml          ← Local development setup
└── application_summary.md      ← This file
```

---

## Backend API

**Base URL (local):** `http://localhost:5000`  
**Base URL (GKE, internal):** `http://backend-service:5000`

| Method | Endpoint | Description | Request Body | Response |
|---|---|---|---|---|
| GET | `/health` | Health check | — | `{"status": "healthy"}` |
| GET | `/version` | Backend version | — | `{"version": "1.1.0"}` |
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

### Error Responses

| Status | Meaning |
|---|---|
| 400 | Missing required fields |
| 404 | Student not found |
| 409 | Student ID already exists |

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

The frontend uses **relative URLs** (`/api/students`) — nginx handles routing to the backend. This means the same frontend image works identically in local Docker and in GKE without any code changes.

### nginx Proxy Config

```nginx
location /api/ {
    proxy_pass http://backend-service:5000/;
}
```

The service name `backend-service` resolves via Kubernetes DNS inside the cluster, and via Docker Compose network aliases locally.

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
| Image | `gcr.io/emerald-water-452417-h1/student-backend:latest` |
| Replicas | 1 |
| Container port | 5000 |
| CPU request/limit | 100m / 300m |
| Memory request/limit | 128Mi / 256Mi |
| Liveness probe | `GET /health` every 15s |
| Readiness probe | `GET /health` every 10s |

### Backend Service

| Field | Value |
|---|---|
| Name | `backend-service` |
| Type | `ClusterIP` (internal only) |
| Port | 5000 |

### Frontend Deployment

| Field | Value |
|---|---|
| Name | `frontend` |
| Image | `gcr.io/emerald-water-452417-h1/student-frontend:latest` |
| Replicas | 2 |
| Container port | 80 |
| CPU request/limit | 50m / 200m |
| Memory request/limit | 64Mi / 128Mi |
| Liveness probe | `GET /` every 20s |
| Readiness probe | `GET /` every 10s |

### Frontend Service

| Field | Value |
|---|---|
| Name | `frontend-service` |
| Type | `LoadBalancer` (public) |
| Port | 80 |
| External IP | 35.255.191.121 |

---

## GKE Cluster Details

| Field | Value |
|---|---|
| Cluster name | `my-gke-cluster` |
| GCP Project ID | `emerald-water-452417-h1` |
| Region / Zone | `us-central1-a` |
| Node pool | `standard-pool` |
| Nodes | 2 x `e2-custom-4-8192` (4 vCPU, 8GB RAM each) |
| Kubernetes context | `gke_emerald-water-452417-h1_us-central1-a_my-gke-cluster` |
| Container Registry | `gcr.io/emerald-water-452417-h1` |

---

## Local Development

Uses Docker Compose. The backend service name in Compose is `backend-service` — matching the Kubernetes service name — so nginx.conf works without changes.

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

- **Frontend version** is defined in `frontend/src/app/version.ts` as `FRONTEND_VERSION`
- **Backend version** is defined in `backend/app.py` as `VERSION`
- Both are displayed in the footer of the UI — frontend version is baked into the build, backend version is fetched live from `GET /api/version` on page load
- Bump the relevant constant whenever a change is made, then rebuild and redeploy the image

---

## Redeployment Steps

### After a backend change

```bash
docker build -t gcr.io/emerald-water-452417-h1/student-backend:latest ./backend
docker push gcr.io/emerald-water-452417-h1/student-backend:latest
kubectl rollout restart deployment/backend -n student-management
```

### After a frontend change

```bash
docker build -t gcr.io/emerald-water-452417-h1/student-frontend:latest ./frontend
docker push gcr.io/emerald-water-452417-h1/student-frontend:latest
kubectl rollout restart deployment/frontend -n student-management
```

### Check rollout status

```bash
kubectl rollout status deployment/backend -n student-management
kubectl rollout status deployment/frontend -n student-management
```
