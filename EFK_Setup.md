# EFK Stack Setup Documentation

## Overview

This document covers the complete setup of an EFK (Elasticsearch, Fluentd, Kibana) logging stack for the Student Management System running on Google Kubernetes Engine (GKE). It includes background concepts, architecture decisions, step-by-step configuration, and all issues encountered with their resolutions.

---

## Table of Contents

1. [Background](#background)
2. [Architecture](#architecture)
3. [Infrastructure](#infrastructure)
4. [Elasticsearch Setup](#elasticsearch-setup)
5. [High Availability — Voting-Only Tiebreaker](#high-availability--voting-only-tiebreaker)
6. [Kibana Setup](#kibana-setup)
7. [Security — Authentication Without TLS on HTTP](#security--authentication-without-tls-on-http)
8. [Fluentd Setup on GKE](#fluentd-setup-on-gke)
9. [GCP Firewall Rules](#gcp-firewall-rules)
10. [Verification](#verification)
11. [Issues Encountered and Resolutions](#issues-encountered-and-resolutions)
12. [Credentials Reference](#credentials-reference)
13. [Maintenance](#maintenance)

---

## Background

### Why EFK?

The Student Management System runs on GKE with multiple pods. Without centralised logging, troubleshooting requires SSH-ing into individual pods and running `kubectl logs` — which is slow, doesn't persist after pod restarts, and can't be searched across pods.

EFK solves this by:
- **Collecting** logs from all pods automatically (Fluentd)
- **Storing** them persistently and making them searchable (Elasticsearch)
- **Visualising** them with filtering, time ranges, and dashboards (Kibana)

### Component Roles

| Component | Role |
|---|---|
| **Fluentd** | Log collector — runs as a DaemonSet on every GKE node, reads container log files, enriches with Kubernetes metadata, ships to Elasticsearch |
| **Elasticsearch** | Log storage and search engine — indexes logs, provides full-text search and aggregations |
| **Kibana** | Web UI — connects to Elasticsearch, provides Discover view, dashboards, and visualisations |

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    GKE Cluster                          │
│                                                         │
│  ┌──────────────────────────────────────────────────┐  │
│  │           student-management namespace           │  │
│  │  backend pod    frontend pod    es-tiebreaker    │  │
│  └──────────────────────────────────────────────────┘  │
│                                                         │
│  ┌──────────────────────────────────────────────────┐  │
│  │              kube-system namespace               │  │
│  │   fluentd pod (node 1)   fluentd pod (node 2)   │  │
│  └──────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
         │                              │
         │ HTTP port 9200               │ Transport port 9300
         │ (authenticated)              │ (TLS)
         ▼                              ▼
┌─────────────────────┐    ┌─────────────────────┐
│      server1        │◄──►│      server2        │
│  Elasticsearch      │    │  Elasticsearch      │
│  es-node-1          │    │  es-node-2          │
│  (master + data)    │    │  (master + data)    │
│                     │    │                     │
│  Kibana             │    │                     │
│  port 5601          │    │                     │
└─────────────────────┘    └─────────────────────┘
         ▲                              ▲
         └──────── es-tiebreaker ───────┘
                  (GKE pod, voting-only)
                  Prevents split-brain
```

### Log Flow

```
Container stdout/stderr
        │
        │ Written to /var/log/containers/*.log on GKE node
        ▼
Fluentd (DaemonSet, 1 pod per node)
        │
        │ 1. Parse CRI log format
        │ 2. Enrich with Kubernetes metadata
        │ 3. Filter: keep only student-management namespace
        │ 4. Buffer to disk
        ▼
Elasticsearch (10.128.0.61:9200)
        │
        │ Indexed as student-management-YYYY.MM.DD
        ▼
Kibana (http://34.170.121.101:5601)
        │
        │ Data view: student-management-*
        ▼
User views and searches logs
```

---

## Infrastructure

### GCP Resources

| Resource | Name | Zone | Internal IP | External IP |
|---|---|---|---|---|
| GKE node 1 | standard-pool-0sxc | us-central1-a | 10.128.0.60 | 34.27.178.30 |
| GKE node 2 | standard-pool-726w | us-central1-a | 10.128.0.59 | 35.193.78.229 |
| Elasticsearch VM 1 | server1 | us-central1-b | 10.128.0.61 | 34.170.121.101 |
| Elasticsearch VM 2 | server2 | us-central1-b | 10.128.0.62 | 136.115.51.0 |

All resources are in the same VPC (`default`) and region (`us-central1`), enabling low-latency internal communication.

### GKE Pod CIDR

```
10.44.0.0/14
```

This is important — Fluentd pods originate traffic from this range, not from the node IPs. GCP firewall rules must allow this range to reach Elasticsearch.

---

## Elasticsearch Setup

### Installation (Both Servers)

Elasticsearch 8.x was installed from the official Elastic APT repository.

```bash
# Add GPG key
wget -qO - https://artifacts.elastic.co/GPG-KEY-elasticsearch | \
  sudo gpg --dearmor -o /usr/share/keyrings/elasticsearch-keyring.gpg

# Add repository
echo "deb [signed-by=/usr/share/keyrings/elasticsearch-keyring.gpg] \
  https://artifacts.elastic.co/packages/8.x/apt stable main" | \
  sudo tee /etc/apt/sources.list.d/elastic-8.x.list

# Install
sudo apt-get update && sudo apt-get install -y elasticsearch
```

### Configuration — server1 (`/etc/elasticsearch/elasticsearch.yml`)

Key settings changed from defaults:

```yaml
# Cluster identity — all nodes must share this name
cluster.name: efk-cluster

# Unique name for this node
node.name: es-node-1

# Listen on all interfaces (not just localhost)
# Safe because GCP firewall controls external access
network.host: 0.0.0.0

# Seed hosts for cluster discovery — IPs of all nodes including tiebreaker
discovery.seed_hosts: ["10.128.0.61", "10.128.0.62", "34.118.237.181"]

# Nodes eligible to be initial master — used only on first cluster bootstrap
cluster.initial_master_nodes: ["es-node-1", "es-node-2", "es-tiebreaker"]

# Security settings
xpack.security.enabled: true
xpack.security.enrollment.enabled: false

# Transport TLS — required when security is enabled
xpack.security.transport.ssl.enabled: true
xpack.security.transport.ssl.verification_mode: certificate
xpack.security.transport.ssl.keystore.path: certs/elastic-certificates.p12
xpack.security.transport.ssl.truststore.path: certs/elastic-certificates.p12

# HTTP without TLS — credentials sent in plain text (acceptable for internal network)
xpack.security.http.ssl.enabled: false
```

### Configuration — server2 (`/etc/elasticsearch/elasticsearch.yml`)

Identical to server1 except:

```yaml
node.name: es-node-2
```

### SSL Certificates

Elasticsearch 8.x requires TLS on the transport layer (node-to-node communication) when security is enabled. Certificates were generated using the built-in `elasticsearch-certutil` tool.

```bash
# Step 1 — Generate Certificate Authority (CA) on server1
sudo /usr/share/elasticsearch/bin/elasticsearch-certutil ca \
  --out /etc/elasticsearch/certs/elastic-ca.p12 --pass ""

# Step 2 — Generate node certificate for server1
sudo /usr/share/elasticsearch/bin/elasticsearch-certutil cert \
  --ca /etc/elasticsearch/certs/elastic-ca.p12 --ca-pass "" \
  --out /etc/elasticsearch/certs/elastic-certificates.p12 --pass "" \
  --dns server1,localhost --ip 10.128.0.61,127.0.0.1

# Step 3 — Generate node certificate for server2
sudo /usr/share/elasticsearch/bin/elasticsearch-certutil cert \
  --ca /etc/elasticsearch/certs/elastic-ca.p12 --ca-pass "" \
  --out /etc/elasticsearch/certs/elastic-certificates-node2.p12 --pass "" \
  --dns server2,localhost --ip 10.128.0.62,127.0.0.1

# Step 4 — Copy server2 certificate to server2 via local machine
# (Direct SSH between VMs was blocked — used gcloud scp as relay)
gcloud compute scp server1:/tmp/elastic-certificates-node2.p12 . --zone us-central1-b
gcloud compute scp elastic-certificates-node2.p12 server2:/tmp/ --zone us-central1-b

# On server2 — move to correct location
sudo mv /tmp/elastic-certificates-node2.p12 /etc/elasticsearch/certs/elastic-certificates.p12
sudo chown root:elasticsearch /etc/elasticsearch/certs/elastic-certificates.p12
sudo chmod 660 /etc/elasticsearch/certs/elastic-certificates.p12
```

### Removing Auto-Generated SSL Keystore Entries

The Elasticsearch installer auto-generates SSL keystore passwords that conflict with our disabled SSL config. These must be removed:

```bash
sudo /usr/share/elasticsearch/bin/elasticsearch-keystore remove \
  xpack.security.transport.ssl.keystore.secure_password
sudo /usr/share/elasticsearch/bin/elasticsearch-keystore remove \
  xpack.security.transport.ssl.truststore.secure_password
sudo /usr/share/elasticsearch/bin/elasticsearch-keystore remove \
  xpack.security.http.ssl.keystore.secure_password
```

### Setting User Passwords

The `elasticsearch-setup-passwords` tool failed because the bootstrap password was already set by the installer. Used `elasticsearch-reset-password` instead:

```bash
# Reset elastic superuser password
sudo /usr/share/elasticsearch/bin/elasticsearch-reset-password -u elastic

# Reset kibana_system user password
sudo /usr/share/elasticsearch/bin/elasticsearch-reset-password -u kibana_system
```

### Creating Fluentd User

A dedicated user was created for Fluentd with write permissions:

```bash
curl -s -u elastic:PASSWORD -X POST "http://localhost:9200/_security/user/fluentd" \
  -H "Content-Type: application/json" \
  -d '{"password":"Fluentd@2026","roles":["superuser"],"full_name":"Fluentd Logger"}'
```

### Enable and Start

```bash
sudo systemctl enable elasticsearch
sudo systemctl start elasticsearch
```

### Verify Cluster Health

```bash
curl -s -u elastic:PASSWORD "http://localhost:9200/_cluster/health?pretty"
curl -s -u elastic:PASSWORD "http://localhost:9200/_cat/nodes?v"
```

---

## High Availability — Voting-Only Tiebreaker

### The Problem: Split Brain with 2 Nodes

Elasticsearch uses quorum-based master election:

```
quorum = (master-eligible nodes / 2) + 1
```

With 2 nodes, quorum = 2. If the network connection between the two VMs breaks (not a crash, just a partition), both nodes think the other is dead and both try to become master independently. This creates two separate clusters with diverging data — called **split brain**.

### The Solution: Voting-Only Node

A **voting-only node** participates in master elections (contributes to quorum) but can never become the active master itself. Adding one as a 3rd node raises quorum to 2-out-of-3, making split brain impossible.

With 3 nodes (quorum = 2):
- VM1 down → VM2 + tiebreaker = quorum → VM2 becomes master ✅
- VM2 down → VM1 + tiebreaker = quorum → VM1 becomes master ✅
- Tiebreaker down → VM1 + VM2 = quorum → existing master stays ✅
- VM1 and VM2 network partition → each has only 1 vote, neither reaches quorum → cluster pauses safely ✅

### Tiebreaker Node in GKE

The tiebreaker runs as a Kubernetes Deployment in the `student-management` namespace. It uses minimal resources since it stores no data.

**Certificate generation for tiebreaker (on server1):**

```bash
sudo /usr/share/elasticsearch/bin/elasticsearch-certutil cert \
  --ca /etc/elasticsearch/certs/elastic-ca.p12 --ca-pass "" \
  --out /tmp/es-tiebreaker.p12 --pass "" \
  --dns es-tiebreaker,es-tiebreaker.student-management.svc.cluster.local \
  --ip 127.0.0.1
```

**Create Kubernetes Secret from certificate:**

```bash
# Download from server1
gcloud compute scp server1:/tmp/es-tiebreaker.p12 . --zone us-central1-b

# Create secret in cluster
kubectl create secret generic es-tiebreaker-certs \
  --from-file=elastic-certificates.p12=es-tiebreaker.p12 \
  -n student-management
```

**Kubernetes manifest (`k8s_manifests/elasticsearch-tiebreaker.yaml`):**

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: es-tiebreaker
  namespace: student-management
spec:
  replicas: 1
  template:
    spec:
      initContainers:
        # Required: Elasticsearch needs vm.max_map_count >= 262144
        # On VMs this is set in /etc/sysctl.conf
        # In Kubernetes it must be set via a privileged init container
        - name: increase-vm-max-map
          image: busybox
          command: ["sysctl", "-w", "vm.max_map_count=262144"]
          securityContext:
            privileged: true
      containers:
        - name: elasticsearch
          image: docker.elastic.co/elasticsearch/elasticsearch:8.19.16
          env:
            - name: node.name
              value: "es-tiebreaker"
            - name: cluster.name
              value: "efk-cluster"
            - name: node.roles
              value: "master,voting_only"   # voting_only must be combined with master
            - name: discovery.seed_hosts
              value: "10.128.0.61,10.128.0.62"
            - name: cluster.initial_master_nodes
              value: "es-node-1,es-node-2,es-tiebreaker"
            - name: xpack.security.transport.ssl.enabled
              value: "true"
            - name: xpack.security.transport.ssl.verification_mode
              value: "certificate"
            - name: xpack.security.transport.ssl.keystore.path
              value: "/usr/share/elasticsearch/config/certs/elastic-certificates.p12"
            - name: ES_JAVA_OPTS
              value: "-Xms256m -Xmx256m"
          volumeMounts:
            - name: certs
              mountPath: /usr/share/elasticsearch/config/certs
              readOnly: true
      volumes:
        - name: certs
          secret:
            secretName: es-tiebreaker-certs
```

**Update VM configs to include tiebreaker in seed hosts:**

After deploying the tiebreaker service (ClusterIP: `34.118.237.181`), update both VMs:

```bash
# On both server1 and server2
sudo sed -i 's/discovery.seed_hosts: \["10.128.0.61", "10.128.0.62"\]/discovery.seed_hosts: ["10.128.0.61", "10.128.0.62", "34.118.237.181"]/' \
  /etc/elasticsearch/elasticsearch.yml

sudo sed -i 's/cluster.initial_master_nodes: \["es-node-1", "es-node-2"\]/cluster.initial_master_nodes: ["es-node-1", "es-node-2", "es-tiebreaker"]/' \
  /etc/elasticsearch/elasticsearch.yml

sudo systemctl restart elasticsearch
```

---

## Kibana Setup

### Installation (server1 only)

Kibana was installed from the same Elastic APT repository as Elasticsearch.

```bash
sudo apt-get install -y kibana
```

### Configuration (`/etc/kibana/kibana.yml`)

```yaml
# Port Kibana listens on
server.port: 5601

# Listen on all interfaces so it's accessible from browser
server.host: "0.0.0.0"

# Elasticsearch connection — use internal IP of server1
elasticsearch.hosts: ["http://10.128.0.61:9200"]

# Credentials for kibana_system user
elasticsearch.username: "kibana_system"
elasticsearch.password: "KIBANA_SYSTEM_PASSWORD"
```

### Enable and Start

```bash
sudo systemctl enable kibana
sudo systemctl start kibana
```

### Access

```
URL:      http://34.170.121.101:5601
Username: elastic
Password: (see credentials reference)
```

### Create Data View in Kibana

1. Go to **☰ Menu → Stack Management → Data Views**
2. Click **Create data view**
3. Set **Name:** `student-management`
4. Set **Index pattern:** `student-management-*`
5. Set **Timestamp field:** `@timestamp`
6. Click **Save data view to Kibana**
7. Go to **☰ Menu → Discover** and select the `student-management` data view

---

## Security — Authentication Without TLS on HTTP

### Design Decision

Elasticsearch 8.x enforces a bootstrap check: **transport TLS is mandatory when security is enabled**. There is no way to bypass this when binding to a non-loopback address.

However, HTTP TLS (the API layer used by Kibana and Fluentd) can be disabled independently. This means:

- **Node-to-node communication (port 9300):** Encrypted with TLS ✅
- **Client API communication (port 9200):** Plain HTTP with username/password authentication ⚠️

Credentials are sent in plain text over HTTP. This is acceptable for an internal GCP network where port 9200 is restricted by firewall rules to internal IPs only. For production, HTTP TLS should also be enabled.

---

## Fluentd Setup on GKE

### Why DaemonSet?

A DaemonSet ensures exactly one Fluentd pod runs on every node in the cluster. This is the correct pattern for log collection because:
- Each node writes container logs to its own filesystem (`/var/log/containers/`)
- A pod on that node can mount and read those files directly
- No network hop needed to collect logs

### RBAC Requirements

Fluentd needs to query the Kubernetes API to enrich logs with pod metadata (namespace, labels, pod name). This requires:

```yaml
ClusterRole:
  - get, list, watch on pods
  - get, list, watch on namespaces
```

### ConfigMap (`k8s_manifests/fluentd-configmap.yaml`)

The Fluentd configuration has 4 stages:

**1. Source — read container log files:**
```
@type tail
path /var/log/containers/*.log
@type cri    ← CRI format used by GKE (not plain JSON)
```

**2. Filter — enrich with Kubernetes metadata:**
```
@type kubernetes_metadata
```
Adds fields like `kubernetes.namespace_name`, `kubernetes.pod_name`, `kubernetes.labels`.

**3. Filter — keep only student-management logs:**
```
@type grep
key $.kubernetes.namespace_name
pattern ^student-management$
```
Drops all system namespace logs (kube-system, argocd etc.) to avoid flooding Elasticsearch.

**4. Match — ship to Elasticsearch (both nodes for HA failover):**
```
@type elasticsearch
hosts 10.128.0.61:9200,10.128.0.62:9200
user fluentd
password Fluentd@2026
logstash_format true
logstash_prefix student-management
logstash_dateformat %Y.%m.%d
resurrect_after 10s       # retry failed hosts every 10s
reload_on_failure true    # reload host list on connection failure
reload_connections false  # don't reload on every request (performance)
```
Creates daily indices named `student-management-2026.05.31` etc.

Both Elasticsearch nodes are listed so Fluentd automatically fails over to server2 if server1 goes down. The `resurrect_after 10s` setting means Fluentd detects the failure within 10 seconds and resumes using both nodes when server1 recovers — no manual intervention needed.

### DaemonSet (`k8s_manifests/fluentd-daemonset.yaml`)

Key volume mounts:

| Mount | Host Path | Purpose |
|---|---|---|
| `/var/log` | `/var/log` | Read container log files and write buffer files |
| `/var/lib/docker/containers` | `/var/lib/docker/containers` | Read raw container output |
| `/fluentd/etc/fluent.conf` | ConfigMap | Custom Fluentd configuration |

### Deploy

```bash
kubectl apply -f k8s_manifests/fluentd-configmap.yaml
kubectl apply -f k8s_manifests/fluentd-daemonset.yaml
```

### Verify

```bash
# Check pods are running
kubectl get pods -n kube-system -l app=fluentd

# Check logs for errors
kubectl logs <fluentd-pod> -n kube-system | grep -i "error\|warn"

# Check index was created in Elasticsearch
curl -s -u elastic:PASSWORD "http://localhost:9200/_cat/indices?v" | grep student
```

### Fluentd HA Failover Behaviour

With both Elasticsearch nodes listed in `hosts`, Fluentd handles node failures automatically:

| Scenario | What happens |
|---|---|
| server1 goes down | Fluentd detects failure, routes all logs to server2 within ~10s |
| server1 comes back | Fluentd resumes using both nodes automatically |
| server2 goes down | Fluentd routes all logs to server1 |
| Both nodes down | Fluentd buffers logs to disk (up to 16MB), retries with exponential backoff |
| Buffer fills up | New logs are blocked until a node becomes available |

The Elasticsearch cluster itself stays up as long as at least 2 of the 3 nodes (including the tiebreaker) are reachable — the tiebreaker ensures quorum is maintained even with one data node down.

---

## GCP Firewall Rules

### Rules Created

| Rule Name | Ports | Source Ranges | Purpose |
|---|---|---|---|
| `elasticsearch-internal` | TCP 9200, 9300 | 10.128.0.0/20, 10.44.0.0/14 | Allow VMs and GKE pods to reach Elasticsearch |
| `kibana-access` | TCP 5601 | 0.0.0.0/0 | Allow browser access to Kibana UI |
| `argocd-nodeport` | TCP 31762 | 0.0.0.0/0 | Allow browser access to ArgoCD UI |

### Important: Two Source Ranges for Elasticsearch

The `elasticsearch-internal` rule requires **two** source ranges:

- `10.128.0.0/20` — the VM/node subnet (for VM-to-VM and node-to-VM traffic)
- `10.44.0.0/14` — the GKE pod CIDR (for Fluentd pod-to-VM traffic)

Without the pod CIDR, Fluentd pods cannot reach Elasticsearch even though the GKE nodes can. This was the root cause of the initial `connect_write timeout` error.

### Commands

```bash
# Create Elasticsearch firewall rule
gcloud compute firewall-rules create elasticsearch-internal \
  --allow tcp:9200,tcp:9300 \
  --source-ranges 10.128.0.0/20 \
  --project emerald-water-452417-h1

# Update to add pod CIDR (discovered after Fluentd timeout errors)
gcloud compute firewall-rules update elasticsearch-internal \
  --source-ranges 10.128.0.0/20,10.44.0.0/14 \
  --project emerald-water-452417-h1

# Create Kibana firewall rule
gcloud compute firewall-rules create kibana-access \
  --allow tcp:5601 \
  --source-ranges 0.0.0.0/0 \
  --project emerald-water-452417-h1
```

---

## Verification

### Elasticsearch Cluster Health

```bash
curl -s -u elastic:PASSWORD "http://localhost:9200/_cluster/health?pretty"
```

Expected output:
```json
{
  "cluster_name": "efk-cluster",
  "status": "green",
  "number_of_nodes": 3,
  "number_of_data_nodes": 2
}
```

### Node List

```bash
curl -s -u elastic:PASSWORD "http://localhost:9200/_cat/nodes?v"
```

Expected output:
```
ip           node.role  master  name
10.128.0.61  cdfhilmrstw  -    es-node-1
10.128.0.62  cdfhilmrstw  *    es-node-2
10.44.x.x    mv           -    es-tiebreaker
```

The `mv` role confirms the tiebreaker is correctly configured as master+voting_only.

### Log Indices

```bash
curl -s -u elastic:PASSWORD "http://localhost:9200/_cat/indices?v" | grep student
```

Expected output:
```
green open student-management-2026.05.31  ... 1 1  XX  0  XXXkb  XXXkb
```

---

## Issues Encountered and Resolutions

### Issue 1: Duplicate `cluster.initial_master_nodes`

**Error:** `Duplicate field 'cluster.initial_master_nodes'`

**Cause:** The Elasticsearch installer auto-generates a `cluster.initial_master_nodes` entry at the bottom of `elasticsearch.yml` with the hostname. When we added our own entry, there were two.

**Resolution:** Comment out the auto-generated entry at line 109:
```bash
sudo sed -i '109s/^/# /' /etc/elasticsearch/elasticsearch.yml
```

---

### Issue 2: SSL Keystore Passwords Conflict

**Error:** `invalid configuration for xpack.security.transport.ssl - [xpack.security.transport.ssl.enabled] is not set, but the following settings have been configured`

**Cause:** The installer stores SSL keystore passwords in the Elasticsearch keystore (separate from `elasticsearch.yml`). When we commented out the SSL config in the YAML, the keystore entries became orphaned and caused a conflict.

**Resolution:** Remove the keystore entries:
```bash
sudo /usr/share/elasticsearch/bin/elasticsearch-keystore remove xpack.security.transport.ssl.keystore.secure_password
sudo /usr/share/elasticsearch/bin/elasticsearch-keystore remove xpack.security.transport.ssl.truststore.secure_password
sudo /usr/share/elasticsearch/bin/elasticsearch-keystore remove xpack.security.http.ssl.keystore.secure_password
```

---

### Issue 3: Security Requires Transport TLS

**Error:** `Transport SSL must be enabled if security is enabled`

**Cause:** Elasticsearch 8.x enforces a bootstrap check — transport TLS is mandatory when `xpack.security.enabled: true` and the node is bound to a non-loopback address. There is no way to bypass this.

**Resolution:** Enable transport TLS with certificates. HTTP TLS was kept disabled to simplify client configuration.

---

### Issue 4: Fluentd `pattern not matched`

**Error:** `[warn]: #0 pattern not matched`

**Cause:** The initial Fluentd config used `@type json` to parse log files. GKE uses the CRI (Container Runtime Interface) log format which has a different structure:
```
2026-05-31T08:42:18Z stdout F {"actual":"json","content":"here"}
```
The `json` parser expected pure JSON but got the CRI timestamp prefix.

**Resolution:** Change the parse type to `@type cri` which handles the GKE log format correctly.

---

### Issue 5: Fluentd Cannot Reach Elasticsearch (Timeout)

**Error:** `connect_write timeout reached`

**Cause:** The GCP firewall rule `elasticsearch-internal` only allowed source range `10.128.0.0/20` (the VM/node subnet). Fluentd pods originate traffic from the GKE pod CIDR `10.44.0.0/14`, which was not in the allowed range.

**Resolution:** Update the firewall rule to include the pod CIDR:
```bash
gcloud compute firewall-rules update elasticsearch-internal \
  --source-ranges 10.128.0.0/20,10.44.0.0/14
```

---

### Issue 6: Tiebreaker Pod Fails — `vm.max_map_count` Too Low

**Error:** `max virtual memory areas vm.max_map_count [65530] is too low, increase to at least [262144]`

**Cause:** Elasticsearch requires the Linux kernel parameter `vm.max_map_count` to be at least 262144. On VMs this is set in `/etc/sysctl.conf`. In Kubernetes, the container shares the host kernel but cannot modify kernel parameters directly.

**Resolution:** Add a privileged init container that runs before Elasticsearch starts:
```yaml
initContainers:
  - name: increase-vm-max-map
    image: busybox
    command: ["sysctl", "-w", "vm.max_map_count=262144"]
    securityContext:
      privileged: true
```

---

### Issue 7: SCP Between VMs Blocked

**Error:** `root@server2: Permission denied (publickey)`

**Cause:** GCP VMs block direct SSH/SCP between instances by default — each VM only has its own SSH key, not the other VM's key.

**Resolution:** Use the local machine as a relay via `gcloud compute scp`:
```bash
# Download from server1 to local
gcloud compute scp server1:/tmp/file.p12 . --zone us-central1-b

# Upload from local to server2
gcloud compute scp file.p12 server2:/tmp/ --zone us-central1-b
```

---

## Credentials Reference

| Service | Username | Notes |
|---|---|---|
| Elasticsearch | `elastic` | Superuser — use for admin tasks and Kibana login |
| Elasticsearch | `kibana_system` | Used by Kibana to connect to Elasticsearch |
| Elasticsearch | `fluentd` | Used by Fluentd to write logs |

> Passwords are stored separately and not included in this document. Refer to the secure credentials store.

---

## Maintenance

### Restart Elasticsearch

```bash
# On server1 or server2
sudo systemctl restart elasticsearch
```

### Check Elasticsearch Logs

```bash
sudo tail -100 /var/log/elasticsearch/efk-cluster.log
```

### Restart Fluentd

```bash
kubectl rollout restart daemonset/fluentd -n kube-system
```

### Check Fluentd Logs

```bash
kubectl logs <fluentd-pod-name> -n kube-system --tail=50
```

### Reset a User Password

```bash
sudo /usr/share/elasticsearch/bin/elasticsearch-reset-password -u <username>
```

### Check Index Storage Usage

```bash
curl -s -u elastic:PASSWORD "http://localhost:9200/_cat/indices?v&s=store.size:desc"
```

### Tiebreaker ClusterIP Change

If the `es-tiebreaker` Kubernetes Service is deleted and recreated, its ClusterIP may change. Update both VMs:

```bash
# Get new ClusterIP
kubectl get svc es-tiebreaker -n student-management

# Update on both server1 and server2
sudo vi /etc/elasticsearch/elasticsearch.yml
# Update discovery.seed_hosts with new ClusterIP
sudo systemctl restart elasticsearch
```
