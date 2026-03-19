# NationsLearner BC

Map-based quiz game for learning First Nations geographies in British Columbia.

Players are prompted with a nation name, click the map, and get up to 3 guesses per round.  
After each wrong guess, the app gives a distance/direction hint.  
At the end, the app shows final score, accuracy, first-try hits, and a review-missed mode.

## Features

- Dataset dropdown to switch between multiple BC First Nations boundary sources
- Selected dataset description panel shown below the dropdown
- 3-attempt round logic with reveal on failure
- Overlap disambiguation with numbered options (no territory names shown)
- Toggle for major BC city markers
- Distance + direction hints after wrong guesses
- Pronunciation button using browser speech synthesis
- Final results and missed-nation review

## Data Sources (Open BC)

- First Nation Statement of Intent Boundaries BC  
  Metadata: [DataBC listing](https://catalogue.data.gov.bc.ca/dataset/69ea1b64-e7ce-481c-b0b5-e6450111697d)  
  Note: this is not intended to represent settled treaty lands.
- First Nations Treaty Areas  
  Metadata: [DataBC listing](https://catalogue.data.gov.bc.ca/dataset/c1a5d55e-fef9-4605-8b20-c08ed4f0c870)
- First Nations Treaty Lands  
  Metadata: [DataBC listing](https://catalogue.data.gov.bc.ca/dataset/fd34808d-4be6-45ea-bc23-65109147933a)
- First Nations Treaty Related Lands  
  Metadata: [DataBC listing](https://catalogue.data.gov.bc.ca/dataset/7b4e5fce-161b-44dd-8ab4-e185d9539a46)

License note: Data is provided by the Province of British Columbia under the Open Government Licence - British Columbia.

## Setup

```bash
npm install
npm run fetch:data
npm run dev
```

## Build

```bash
npm run fetch:data
npm run build
```

## GitHub Pages

- Workflow file: `.github/workflows/deploy-pages.yml`
- Vite base path is configured for project pages at `/BC_FN_Territory_Learner/`
- After your first push to `main`, enable Pages in GitHub:
  - `Settings` -> `Pages` -> `Source: GitHub Actions`
