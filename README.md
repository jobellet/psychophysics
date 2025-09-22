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
   git clone https://github.com/psychophysics-lab/psychophysics.git
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
The project lives on GitHub at [psychophysics-lab/psychophysics](https://github.com/psychophysics-lab/psychophysics).
