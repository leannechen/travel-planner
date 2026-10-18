# Designer fixes

Changes the design files need. Update the `source/` files and re-export the PNGs, then tick the item.

## Opening hours are read-only (decided 2026-10-18)

Opening hours come from Google and the user cannot edit them (PRD §3.2). The field must look read-only (plain text, no dropdown chevron), and the kind-switch note must not mention opening hours.

- [ ] `PanelSwitch.dc.html` (#09): remove "opening hours" from the notes ("Duration and opening hours kept, hidden for Lodging" becomes "Duration kept, hidden for Lodging"; same for the Transport example text).
- [ ] `EventPanelSide.dc.html` (#04), `PanelKinds.dc.html` (#07), `MapView.dc.html` (#06): the Opening hours field is drawn as an input with a chevron; draw it as read-only text with a "from Google" hint.
- [ ] `Viewer.dc.html` (#18), `EventPanel*.dc.html`, `PanelKindsPhone.dc.html`: check the same.
- [ ] `DSComponents.dc.html` (#30): no change expected (the warning style stays).

## Earlier list

- [ ] Language, theme, Share and Export placement at the bottom of the left sidebar (the full earlier list was only in chat; add the other items here).
