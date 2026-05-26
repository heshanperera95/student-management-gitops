# Student Management System — TODO

## Critical (Must Do)

### Database Setup
- [ ] Deploy PostgreSQL on GKE (or use Cloud SQL managed instance)
- [ ] Create `students` table schema
- [ ] Update `backend/app.py` to use PostgreSQL instead of in-memory dict
- [ ] Add `psycopg2-binary` to `requirements.txt`
- [ ] Create Kubernetes `Secret` for DB credentials (never hardcode)
- [ ] Create Kubernetes `ConfigMap` for DB host/port/name
- [ ] Mount secret and configmap as env vars in `backend-deployment.yaml`
- [ ] If using Cloud SQL — set up Cloud SQL Auth Proxy sidecar in backend pod
- [ ] Test data persistence across pod restarts

---

## Observability

### EFK Stack (Elasticsearch + Fluentd + Kibana)
- [ ] Deploy Elasticsearch on GKE (or use Elastic Cloud)
- [ ] Deploy Fluentd as a DaemonSet to collect logs from all pods
- [ ] Configure Fluentd to forward logs to Elasticsearch
- [ ] Deploy Kibana and expose via NodePort
- [ ] Create index pattern in Kibana for pod logs
- [ ] Create dashboards for backend API request logs
- [ ] Add GCP firewall rule for Kibana NodePort
- [ ] Add structured JSON logging to Flask backend (replace print statements)

### Metrics
- [ ] Deploy Prometheus + Grafana (or use Google Cloud Monitoring)
- [ ] Add `/metrics` endpoint to Flask backend using `prometheus-flask-exporter`
- [ ] Create Grafana dashboard for API request rate, latency, error rate
- [ ] Set up alerts for pod restarts and high error rates

---

## Security

- [ ] Move ArgoCD admin password — create a dedicated user, disable default admin
- [ ] Enable HTTPS on frontend (add GCP managed SSL certificate + Ingress)
- [ ] Add Kubernetes `NetworkPolicy` to restrict backend access to frontend only
- [ ] Scan Docker images for vulnerabilities (use `docker scout` or GCP Artifact Analysis)
- [ ] Set up GCP Workload Identity instead of broad service account permissions
- [ ] Add input validation on frontend (email format, phone format)
- [ ] Add rate limiting to Flask API (e.g. `flask-limiter`)

---

## CI/CD Improvements

- [ ] Set up GitHub Actions workflow to automate:
  - Build Docker image on push
  - Push to GCR with version tag
  - Update image tag in `k8s_manifests/`
  - Commit and push manifest change (triggers ArgoCD)
- [ ] Add automated tests to CI pipeline (pytest for backend, Karma for frontend)
- [ ] Set up branch protection on `main` — require PR + review before merge
- [ ] Add ArgoCD notifications (Slack/email) on sync success/failure

---

## Reliability

- [ ] Add Horizontal Pod Autoscaler (HPA) for frontend and backend
- [ ] Configure Pod Disruption Budget (PDB) to ensure availability during node upgrades
- [ ] Add `preStop` hook to backend for graceful shutdown
- [ ] Test rolling deployments — verify zero downtime
- [ ] Set up GKE cluster auto-upgrade and auto-repair
- [ ] Document rollback procedure (ArgoCD can roll back via UI or CLI)

---

## Cost Optimisation

- [ ] Set up GKE cluster autoscaler to scale nodes down during off-hours
- [ ] Review and right-size resource requests/limits after DB and EFK are added
- [ ] Consider using Spot (preemptible) nodes for non-critical workloads
- [ ] Set up GCP Billing alerts

---

## Nice to Have

- [ ] Add pagination to the student list (frontend + backend)
- [ ] Add search/filter functionality to student list
- [ ] Add student photo upload (GCS bucket)
- [ ] Add `GET /students/:id` button in the UI (currently only used via API)
- [ ] Dark mode for the frontend
- [ ] Export student list to CSV

---

## Done ✅

- [x] Angular frontend with Add/Edit/Delete/Load students
- [x] Python Flask backend with REST API
- [x] Docker containerisation (multi-stage builds)
- [x] Local development with Docker Compose
- [x] Deployed to GKE (2 nodes, e2-custom-4-8192)
- [x] ArgoCD GitOps setup — auto-deploys on manifest change
- [x] GitHub repo connected to ArgoCD
- [x] Versioned Docker image tags (no more :latest)
- [x] Version footer on frontend (frontend + backend versions)
- [x] application_summary.md documentation
