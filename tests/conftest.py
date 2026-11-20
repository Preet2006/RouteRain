import os

# Tests never start the background prefetch (it would call the live forecast API).
os.environ.setdefault("ROUTERAIN_SKIP_PREFETCH", "1")
