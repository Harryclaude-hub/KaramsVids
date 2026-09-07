"""KaramsVids Worker.

Der lokale Maschinenraum der Web-App: holt Schnittauftraege aus Supabase,
transkribiert das Video, waehlt die tragenden Stellen aus, schneidet
Hochformat-Clips mit eingebrannten Untertiteln und legt sie zurueck.

Aufruf:  python -m karam_worker            (Endlosschleife)
         python -m karam_worker --once     (einen Auftrag, dann Ende)
         python -m karam_worker --local pfad.mp4 --clips 3   (ohne Supabase)
"""

__version__ = "0.1.0"
