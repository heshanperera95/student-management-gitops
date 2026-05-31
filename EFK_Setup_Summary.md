# EFK Stack Setup — Summary

## What We Built

A centralised logging system for the Student Management System on GKE using the EFK stack (Elasticsearch, Fluentd, Kibana). Logs from all application pods are automatically collected, stored, and made searchable through a web UI.

---

## Components

| Component | Where | Purpose |
|---|---|---|
| Elasticsearch node 1 (`es-node-1`) | server1 — 10.128.0.61 | Log storage, master-eligible |
| Elasticsearch node 2 (`es-node-2`) | server2 — 10.128.0.62 | Log storage, master-eligible |
| Elasticsearch tiebreaker (`es-tiebreaker`) | GKE pod | Voting-only master, prevents split-brain |
| Kibana | server1 — port 5601 | Log visualisation UI |
| Fluentd | GKE DaemonSet (kube-system) | Log collection and shipping |

---

## Architecture at a Glance

```
GKE Pods → Fluentd (DaemonSet) → Elasticsearch (2 VMs + tiebreaker) → Kibana
```

- Fluentd runs on every GKE node, reads container logs, filters to `student-management` namespace, ships to Elasticsearch
- Elasticsearch runs as a 3-node cluster — 2 data nodes on VMs + 1 voting-only tiebreaker in GKE
- Kibana connects to Elasticsearch and provides the search/visualisation UI

---

## What Was Done — Step by Step

### 1. Elasticsearch Installation (Both VMs)
- Added Elastic APT repository and installed Elasticsearch 8.x
- Configured cluster name, node names, network binding, and discovery

### 2. TLS Certificate Setup
- Generated a CA using `elasticsearch-certutil ca`
- Generated individual node certificates for server1, server2, and the tiebreaker
- Copied certificates between machines using `gcloud compute scp` as a relay (direct VM-to-VM SCP was blocked)
- Removed auto-generated SSL keystore entries that conflicted with our config

### 3. Security Configuration
- Enabled `xpack.security` with transport TLS (mandatory in ES 8.x)
- Disabled HTTP TLS (acceptable for internal network — credentials protected by GCP firewall)
- Reset passwords for `elastic` and `kibana_system` built-in users
- Created a dedicated `fluentd` user for log ingestion

### 4. High Availability — Voting-Only Tiebreaker
- Problem: 2-node Elasticsearch cluster is vulnerable to split-brain (both nodes claim to be master during a network partition)
- Solution: Added a 3rd node in GKE configured as `voting_only` — it participates in master elections but never becomes master
- This raises quorum to 2-out-of-3, making split-brain impossible
- The tiebreaker uses minimal resources (256MB RAM, no data storage)
- Required a privileged init container to set `vm.max_map_count=262144` (kernel requirement for Elasticsearch in containers)

### 5. Kibana Installation (server1)
- Installed Kibana from the same Elastic repository
- Configured to listen on all interfaces, connect to Elasticsearch via internal IP
- Set `kibana_system` credentials for Elasticsearch connection
- Created a data view `student-management-*` in Kibana Discover

### 6. Fluentd on GKE
- Deployed as a DaemonSet in `kube-system` namespace — one pod per node
- Configured RBAC (ServiceAccount, ClusterRole, ClusterRoleBinding) to allow Kubernetes metadata enrichment
- Custom `fluent.conf` via ConfigMap with 4-stage pipeline:
  - **Source:** tail `/var/log/containers/*.log` using CRI format (GKE's log format)
  - **Filter 1:** enrich with Kubernetes metadata (pod name, namespace, labels)
  - **Filter 2:** keep only `student-management` namespace logs
  - **Match:** ship to Elasticsearch with authentication

### 7. Fluentd HA Failover
- Initial config pointed Fluentd to server1 only — if server1 went down, logs would stop flowing
- Updated to use `hosts` (plural) with both nodes: `10.128.0.61:9200,10.128.0.62:9200`
- Added `resurrect_after 10s` — Fluentd detects failure and fails over within 10 seconds
- Logs automatically resume to both nodes when the failed node recovers

### 8. GCP Firewall Rules
- `elasticsearch-internal` — allows ports 9200 and 9300 from VM subnet AND GKE pod CIDR
- `kibana-access` — allows port 5601 from anywhere (public Kibana access)
- Key lesson: GKE pod traffic originates from `10.44.0.0/14` (pod CIDR), not from node IPs — both ranges must be in the firewall rule

---

## Key Issues Resolved

| Issue | Root Cause | Fix |
|---|---|---|
| Duplicate `cluster.initial_master_nodes` | Installer auto-generates this field | Comment out the auto-generated line |
| SSL keystore conflict | Installer stores keystore passwords separately | Remove with `elasticsearch-keystore remove` |
| Transport TLS mandatory | ES 8.x bootstrap check — cannot be bypassed | Generate and configure certificates |
| Fluentd `pattern not matched` | GKE uses CRI log format, not plain JSON | Change parse type to `@type cri` |
| Fluentd timeout to Elasticsearch | GKE pod CIDR not in firewall rule | Add `10.44.0.0/14` to firewall source ranges |
| Tiebreaker pod fails to start | `vm.max_map_count` too low in container | Add privileged init container to set it |
| SCP between VMs blocked | GCP blocks direct VM-to-VM SSH by default | Use local machine as relay via `gcloud compute scp` |

---

## Access Points

| Service | URL | Credentials |
|---|---|---|
| Kibana | http://34.170.121.101:5601 | elastic / (see credentials store) |
| Elasticsearch API | http://10.128.0.61:9200 | elastic / (see credentials store) |

---

## Files Created

| File | Purpose |
|---|---|
| `k8s_manifests/fluentd-configmap.yaml` | Fluentd configuration (pipeline, ES connection) |
| `k8s_manifests/fluentd-daemonset.yaml` | Fluentd DaemonSet, RBAC resources |
| `k8s_manifests/elasticsearch-tiebreaker.yaml` | ES tiebreaker Deployment and Service |
| `EFK_Setup.md` | Full detailed documentation |
| `EFK_Setup_Summary.md` | This file |

---

## Current State

```
Elasticsearch cluster: GREEN — 3 nodes, 2 data nodes
Fluentd: Running on both GKE nodes, shipping to both ES nodes
Kibana: Running, authenticated, data view configured
Logs indexed: student-management-YYYY.MM.DD (daily indices)
HA: Full — single node failure handled by both ES cluster and Fluentd failover
```
