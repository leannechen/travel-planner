# Events use absolute start times, not cumulative stacking

Every Event placed in a Day has its own start time and duration on the Day's time axis, as in Toggl; start times are never computed by stacking from a Day start time. Events may overlap, and editing one Event never moves another. We chose this so a fixed commitment (such as an 18:00 dinner) can exist independently of what precedes it, and so each Event's time is independent when collaborators edit at once.

## Considered Options

- **Cumulative stacking** (start times derived from the previous Event's end plus travel): simpler drag-to-reorder, but cannot express fixed times and makes one edit shift the whole day.
