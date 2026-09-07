"""Gemeinsame Fehlerklasse fuer Meldungen, die fuer sich stehen.

Alles, was hiervon erbt (DbError, ApiError, StorageError), wird in main.py als
Klartext ausgegeben, ohne Traceback: der Text erklaert bereits, was zu tun ist.
Das Modul zieht bewusst keine weiteren Pakete nach, damit main.py es laden kann,
ohne den Supabase-Client anzufassen.
"""

from __future__ import annotations


class WorkerError(RuntimeError):
    """Fehler, dessen Meldung dem Nutzer reicht."""
