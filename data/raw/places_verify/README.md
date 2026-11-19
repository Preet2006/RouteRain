# Verifying the draft places

53 places in `../places_gurugram_DRAFT.csv` have approximate coordinates typed from memory. They are split
into 4 sheets (`sheet_1.csv` to `sheet_4.csv`, 14/13/13/13 rows). The 12 hotspot rows reuse the
coordinates already checked in Phase 2 and are not listed here.

For each row:
1. Search `name` on Google Maps (or OpenStreetMap) and drop a pin where a driver would be picked up or dropped off.
2. Compare with `lat`, `lon`. If the difference is more than about 150 m, type the correct values into `lat` and `lon`.
3. For sector rows, use the centre of the sector's main road or market.
4. Put your name in `checked_by` once the row is right. Leave it empty if you are unsure.

Send the sheet back as-is. `checked_by` is the only column that proves a row was checked; the draft keeps
`verified=0` until the rows are merged back.
