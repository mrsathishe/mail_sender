# Kubernetes deployment

Production manifests for Mail Sender. The app is stateless, so it scales
horizontally; MongoDB is external (Atlas or a managed instance), not part of
these manifests.

## Files

| File | Purpose |
|---|---|
| `namespace.yaml` | `mail-sender` namespace |
| `secret.example.yaml` | **Template** for `mail-sender-secrets` — never commit real values |
| `deployment.yaml` | 2 replicas, non-root, read-only rootfs, `/api/health` probes |
| `service.yaml` | ClusterIP `80 → 3000` |
| `ingress.yaml` | nginx + TLS (cert-manager), host `mail-sender.example.com` |
| `hpa.yaml` | Autoscale 2→10 on 70% CPU |
| `kustomization.yaml` | Ties the above together (excludes the Secret) |

## Deploy

1. Build & push the image (see the repo `Dockerfile`), then set the tag:
   ```sh
   # in k8s/kustomization.yaml -> images[].newTag, or:
   kustomize edit set image ghcr.io/mrsathishe/mail_sender=ghcr.io/mrsathishe/mail_sender:<tag>
   ```
2. Create the Secret (kept out of git):
   ```sh
   kubectl create namespace mail-sender
   kubectl -n mail-sender create secret generic mail-sender-secrets \
     --from-literal=MONGO_URI='mongodb://user:pass@host:27017/mail_sender?authSource=mail_sender' \
     --from-literal=AUTH_SECRET="$(openssl rand -base64 32)" \
     --from-literal=SMTP_USER='youraccount@gmail.com' \
     --from-literal=SMTP_PASS='your-16-char-app-password' \
     --from-literal=SMTP_FROM='youraccount@gmail.com'
   ```
3. Apply:
   ```sh
   kubectl apply -k k8s/
   ```
4. Point `APP_URL` (in `deployment.yaml`) and the Ingress `host` at your real domain.

## Notes

- **Password URL-encoding:** the `@` in a Mongo password must be `%40` in the URI.
- **Egress:** the mail route needs outbound SMTP on port 587 — allow it in any NetworkPolicy.
- **HPA** requires metrics-server installed in the cluster.
- The Gmail send limit (~500–2000/day per sender) is the real throughput ceiling — pod scaling won't raise it.
