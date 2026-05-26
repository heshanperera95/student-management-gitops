#!/usr/bin/env bash
# ============================================================
# Student Management System — Build & Deploy Script
# Prerequisites: Docker, gcloud CLI authenticated, kubectl
#                configured against your GKE cluster.
# Usage: ./deploy.sh <GCR_PROJECT_ID>
# Example: ./deploy.sh my-gcp-project-123
# ============================================================

set -euo pipefail

if [ -z "${1:-}" ]; then
  echo "Usage: $0 <GCP_PROJECT_ID>"
  exit 1
fi

PROJECT_ID="$1"
REGISTRY="gcr.io/${PROJECT_ID}"
BACKEND_IMAGE="${REGISTRY}/student-backend:latest"
FRONTEND_IMAGE="${REGISTRY}/student-frontend:latest"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "======================================================"
echo " Project  : ${PROJECT_ID}"
echo " Registry : ${REGISTRY}"
echo "======================================================"

# ---------- Configure Docker for GCR ----------
echo "[1/6] Configuring Docker for GCR..."
gcloud auth configure-docker --quiet

# ---------- Build & push backend ----------
echo "[2/6] Building backend image..."
docker build -t "${BACKEND_IMAGE}" "${SCRIPT_DIR}/backend"

echo "[3/6] Pushing backend image..."
docker push "${BACKEND_IMAGE}"

# ---------- Build & push frontend ----------
echo "[4/6] Building frontend image..."
docker build -t "${FRONTEND_IMAGE}" "${SCRIPT_DIR}/frontend"

echo "[5/6] Pushing frontend image..."
docker push "${FRONTEND_IMAGE}"

# ---------- Patch image references in manifests ----------
echo "[6/6] Patching manifests and applying to cluster..."

sed -i "s|YOUR_REGISTRY/student-backend:latest|${BACKEND_IMAGE}|g" \
    "${SCRIPT_DIR}/k8s_manifests/backend-deployment.yaml"

sed -i "s|YOUR_REGISTRY/student-frontend:latest|${FRONTEND_IMAGE}|g" \
    "${SCRIPT_DIR}/k8s_manifests/frontend-deployment.yaml"

# ---------- Deploy ----------
kubectl apply -f "${SCRIPT_DIR}/k8s_manifests/namespace.yaml"
kubectl apply -f "${SCRIPT_DIR}/k8s_manifests/backend-deployment.yaml"
kubectl apply -f "${SCRIPT_DIR}/k8s_manifests/backend-service.yaml"
kubectl apply -f "${SCRIPT_DIR}/k8s_manifests/frontend-deployment.yaml"
kubectl apply -f "${SCRIPT_DIR}/k8s_manifests/frontend-service.yaml"

echo ""
echo "======================================================"
echo " Deployment complete!"
echo " Waiting for frontend LoadBalancer IP..."
echo "======================================================"

# Poll for external IP (up to 3 min)
for i in $(seq 1 18); do
  EXTERNAL_IP=$(kubectl get svc frontend-service -n student-management \
    -o jsonpath='{.status.loadBalancer.ingress[0].ip}' 2>/dev/null || true)
  if [ -n "${EXTERNAL_IP}" ]; then
    echo " Frontend URL: http://${EXTERNAL_IP}"
    exit 0
  fi
  echo " Waiting... (${i}/18)"
  sleep 10
done

echo " LoadBalancer IP not ready yet. Run:"
echo "   kubectl get svc frontend-service -n student-management"
