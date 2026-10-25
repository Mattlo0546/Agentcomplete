"""Small, process-local caches. Nothing here is written to disk or telemetry."""

import time
from collections import OrderedDict


class TTLCache[K, V]:
    def __init__(self, maxsize: int, ttl_s: float) -> None:
        self.maxsize = maxsize
        self.ttl_s = ttl_s
        self._items: OrderedDict[K, tuple[float, V]] = OrderedDict()

    def get(self, key: K) -> V | None:
        item = self._items.get(key)
        if item is None:
            return None
        expires, value = item
        if expires <= time.monotonic():
            del self._items[key]
            return None
        self._items.move_to_end(key)
        return value

    def put(self, key: K, value: V) -> None:
        self._items[key] = (time.monotonic() + self.ttl_s, value)
        self._items.move_to_end(key)
        while len(self._items) > self.maxsize:
            self._items.popitem(last=False)

    def clear(self) -> None:
        self._items.clear()

    def discard(self, key: K) -> None:
        self._items.pop(key, None)
