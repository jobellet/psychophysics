# Psychophysics Experiments

Explore a collection of browser-based cognitive psychology experiments designed to run anywhere modern browsers are available. The project showcases tasks built with [jsPsych](https://www.jspsych.org/latest/) and the adaptive [jsQuestPlus](https://github.com/jspsych/jsQuestPlus) staircase algorithm to investigate perceptual thresholds and attentional limits.

## Project overview
- **Interactive experiment hub** – The landing page (`index.html`) introduces the lab and lists the available experiments with friendly descriptions and quick-start links.
- **JND Go/No-Go (Dot Reappearance)** – Participants judge whether a briefly hidden dot changes when it reappears. Multiple jsQuestPlus staircases adapt stimulus angle, distance, and size to converge on a 70% detection threshold.
- **Attentional Blink (Digits)** – A rapid serial visual presentation (RSVP) task that probes the temporal limits of attention by asking participants to report two target digits hidden in a stream of letters.
- **Responsive design** – Layout and typography scale smoothly across desktop and mobile screens, with automatic support for light and dark colour schemes.

## Getting started
1. Clone the repository:
   ```bash
   git clone https://github.com/jobellet/psychophysics.git
   cd psychophysics
   ```
2. Serve the site locally (any static file server works). For example, using `npx`:
   ```bash
   npx serve .
   ```
3. Open `http://localhost:3000` (or the port reported by your server) in a browser to explore the experiments.

## Contributing
Contributions are welcome! Open an issue or submit a pull request to suggest new experiment paradigms, report bugs, or improve documentation.

## GitHub
The project lives on GitHub at [jobellet/psychophysics](https://github.com/jobellet/psychophysics) and is published via GitHub Pages at [jobellet.github.io/psychophysics/](https://jobellet.github.io/psychophysics/).

## Naturalistic Audio Stimuli
The `assets/sounds` directory contains a standardized naturalistic audio stimuli database designed for cognitive neuroscience and behavioral experiments. These short, recognizable, and emotionally rated audio clips span various categories (e.g., animals, mechanical, speech, nature) and can be easily re-used across new paradigms.

**References:**
- **Study:** Al-Naji, A., Schubotz, R. I., & Zahedi, A. (2026). *A standardized naturalistic audio stimuli database with unsupervised labeling*. bioRxiv. [https://doi.org/10.64898/2026.04.16.718910](https://doi.org/10.64898/2026.04.16.718910)
- **Data Origin:** The original data, including full ratings and categorizations, was obtained from OSF: [https://osf.io/7wqnm/overview?view_only=af0f2b4608c6407497daf8360d9a3710](https://osf.io/7wqnm/overview?view_only=af0f2b4608c6407497daf8360d9a3710)
