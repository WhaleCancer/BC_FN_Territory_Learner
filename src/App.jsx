import { useCallback, useEffect, useMemo, useState } from 'react';
import { CircleMarker, GeoJSON, MapContainer, TileLayer, Tooltip } from 'react-leaflet';
import bearing from '@turf/bearing';
import booleanPointInPolygon from '@turf/boolean-point-in-polygon';
import centroid from '@turf/centroid';
import distance from '@turf/distance';
import './App.css';

const ATTEMPTS_PER_ROUND = 3;
const BC_BOUNDS = [
  [47.5, -139.3],
  [60.3, -113.5],
];
const DATA_BASE_URL = `${import.meta.env.BASE_URL}data/`;
const MAJOR_CITIES = [
  { name: 'Vancouver', coordinates: [49.2827, -123.1207] },
  { name: 'Victoria', coordinates: [48.4284, -123.3656] },
  { name: 'Nanaimo', coordinates: [49.1659, -123.9401] },
  { name: 'Prince George', coordinates: [53.9171, -122.7497] },
  { name: 'Kelowna', coordinates: [49.888, -119.496] },
  { name: 'Kamloops', coordinates: [50.6745, -120.3273] },
  { name: 'Abbotsford', coordinates: [49.0504, -122.3045] },
  { name: 'Chilliwack', coordinates: [49.1579, -121.9515] },
  { name: 'Surrey', coordinates: [49.1913, -122.849] },
  { name: 'Burnaby', coordinates: [49.2488, -122.9805] },
  { name: 'Terrace', coordinates: [54.5182, -128.6035] },
  { name: 'Fort St. John', coordinates: [56.2468, -120.8467] },
];

function shuffle(values) {
  const cloned = [...values];
  for (let index = cloned.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [cloned[index], cloned[swapIndex]] = [cloned[swapIndex], cloned[index]];
  }
  return cloned;
}

function asCardinalDirection(angle) {
  const directions = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  const normalized = ((angle % 360) + 360) % 360;
  const index = Math.round(normalized / 45) % directions.length;
  return directions[index];
}

function getCoordinatesFromFeature(feature) {
  const centerPoint = centroid(feature);
  return centerPoint.geometry.coordinates;
}

function buildDirectionHint(guessFeature, targetFeature) {
  try {
    const from = getCoordinatesFromFeature(guessFeature);
    const to = getCoordinatesFromFeature(targetFeature);
    const km = Math.max(1, Math.round(distance(from, to, { units: 'kilometers' })));
    const heading = asCardinalDirection(bearing(from, to));
    return `${km} km ${heading}`;
  } catch {
    return 'Keep exploring nearby';
  }
}

function getPointsForAttempt(attempt) {
  return ATTEMPTS_PER_ROUND - attempt + 1;
}

function buildPrompt(roundIndex, totalRounds, targetName) {
  return `Round ${roundIndex + 1}/${totalRounds}: find ${targetName}.`;
}

function asPointFeature(latLng) {
  return {
    type: 'Feature',
    properties: {},
    geometry: {
      type: 'Point',
      coordinates: [latLng.lng, latLng.lat],
    },
  };
}

function App() {
  const [datasetCatalog, setDatasetCatalog] = useState([]);
  const [datasetCache, setDatasetCache] = useState({});
  const [selectedDatasetId, setSelectedDatasetId] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadingMessage, setLoadingMessage] = useState('Loading dataset catalog...');
  const [loadError, setLoadError] = useState('');

  const [queue, setQueue] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [attempt, setAttempt] = useState(1);
  const [roundGuesses, setRoundGuesses] = useState([]);
  const [roundResolved, setRoundResolved] = useState(false);
  const [results, setResults] = useState([]);
  const [score, setScore] = useState(0);
  const [statusMessage, setStatusMessage] = useState('Loading map data...');
  const [isFinished, setIsFinished] = useState(false);
  const [overlapChoices, setOverlapChoices] = useState([]);
  const [selectedOverlapId, setSelectedOverlapId] = useState(null);
  const [showMajorCities, setShowMajorCities] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function loadDatasetCatalog() {
      setLoading(true);
      setLoadingMessage('Loading dataset catalog...');
      setLoadError('');

      try {
        const response = await fetch(`${DATA_BASE_URL}sources.json`);
        if (!response.ok) {
          throw new Error('Dataset catalog not found');
        }

        const catalog = await response.json();
        const datasets = Array.isArray(catalog.datasets) ? catalog.datasets : [];
        if (!datasets.length) {
          throw new Error('Dataset catalog has no entries');
        }

        const defaultDatasetId =
          typeof catalog.defaultDatasetId === 'string' &&
          datasets.some((dataset) => dataset.id === catalog.defaultDatasetId)
            ? catalog.defaultDatasetId
            : datasets[0].id;

        if (cancelled) {
          return;
        }

        setDatasetCatalog(datasets);
        setSelectedDatasetId(defaultDatasetId);
      } catch {
        if (!cancelled) {
          setLoadError(
            'Could not load dataset catalog. Run "npm run fetch:data" to regenerate local dataset files, then reload.',
          );
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    loadDatasetCatalog();

    return () => {
      cancelled = true;
    };
  }, []);

  const selectedDatasetMeta = useMemo(
    () => datasetCatalog.find((dataset) => dataset.id === selectedDatasetId) ?? null,
    [datasetCatalog, selectedDatasetId],
  );

  useEffect(() => {
    if (!selectedDatasetMeta || !selectedDatasetId) {
      return;
    }

    if (datasetCache[selectedDatasetId]) {
      return;
    }

    let cancelled = false;

    async function loadSelectedDataset() {
      setLoading(true);
      setLoadingMessage(`Loading ${selectedDatasetMeta.displayName}...`);
      setLoadError('');

      try {
        const response = await fetch(`${DATA_BASE_URL}${selectedDatasetMeta.outputFile}`);
        if (!response.ok) {
          throw new Error('Dataset file missing');
        }

        const collection = await response.json();
        if (cancelled) {
          return;
        }

        setDatasetCache((current) => ({
          ...current,
          [selectedDatasetId]: collection,
        }));
      } catch {
        if (!cancelled) {
          setLoadError(
            `Could not load "${selectedDatasetMeta.displayName}". Run "npm run fetch:data" and reload.`,
          );
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    loadSelectedDataset();

    return () => {
      cancelled = true;
    };
  }, [datasetCache, selectedDatasetId, selectedDatasetMeta]);

  const activeDataset = selectedDatasetId ? datasetCache[selectedDatasetId] ?? null : null;
  const activeFeatures = useMemo(() => activeDataset?.features ?? [], [activeDataset]);
  const featureById = useMemo(() => {
    const map = new Map();
    for (const feature of activeFeatures) {
      map.set(feature.properties.id, feature);
    }
    return map;
  }, [activeFeatures]);

  const targetId = queue[currentIndex] ?? null;
  const targetFeature = targetId ? featureById.get(targetId) : null;
  const targetName = targetFeature?.properties?.name ?? '';
  const guessedIds = useMemo(() => new Set(roundGuesses), [roundGuesses]);
  const overlapChoiceIds = useMemo(
    () =>
      new Set(
        overlapChoices
          .map((feature) => feature?.properties?.id)
          .filter(Boolean),
      ),
    [overlapChoices],
  );

  const maxScore = queue.length * ATTEMPTS_PER_ROUND;
  const correctCount = results.filter((entry) => entry.correct).length;
  const firstTryCount = results.filter((entry) => entry.correct && entry.attempts === 1).length;
  const missedResults = results.filter((entry) => !entry.correct);
  const accuracy = queue.length === 0 ? 0 : Math.round((correctCount / queue.length) * 100);

  const startGame = useCallback(
    (featureIds = null) => {
      const allIds = activeFeatures.map((feature) => feature.properties.id).filter(Boolean);
      const requestedIds =
        Array.isArray(featureIds) && featureIds.length
          ? featureIds.filter((id) => featureById.has(id))
          : allIds;
      const shuffledQueue = shuffle(requestedIds);

      setQueue(shuffledQueue);
      setCurrentIndex(0);
      setAttempt(1);
      setRoundGuesses([]);
      setRoundResolved(false);
      setResults([]);
      setScore(0);
      setIsFinished(false);
      setOverlapChoices([]);
      setSelectedOverlapId(null);

      if (shuffledQueue.length === 0) {
        setStatusMessage('No entries are available in this dataset.');
        setIsFinished(true);
        return;
      }

      const firstName = featureById.get(shuffledQueue[0])?.properties?.name ?? 'Unknown nation';
      setStatusMessage(buildPrompt(0, shuffledQueue.length, firstName));
    },
    [activeFeatures, featureById],
  );

  useEffect(() => {
    if (!loading && !loadError && activeFeatures.length > 0) {
      startGame();
    }
  }, [loading, loadError, activeFeatures, selectedDatasetId, startGame]);

  const submitGuess = useCallback(
    (clickedFeature) => {
      if (loading || loadError || isFinished || roundResolved || !targetFeature || !targetId) {
        return;
      }

      const guessedId = clickedFeature?.properties?.id;
      const guessedName = clickedFeature?.properties?.name ?? 'that nation';

      if (!guessedId) {
        return;
      }

      setOverlapChoices([]);
      setSelectedOverlapId(null);

      if (guessedIds.has(guessedId)) {
        setStatusMessage(`You already guessed ${guessedName}. Pick a different nation.`);
        return;
      }

      const updatedGuesses = [...roundGuesses, guessedId];

      if (guessedId === targetId) {
        const earnedPoints = getPointsForAttempt(attempt);
        setRoundGuesses(updatedGuesses);
        setRoundResolved(true);
        setScore((current) => current + earnedPoints);
        setResults((current) => [
          ...current,
          {
            targetId,
            name: targetName,
            correct: true,
            attempts: attempt,
          },
        ]);
        setStatusMessage(`Correct: ${targetName}. +${earnedPoints} points.`);
        return;
      }

      setRoundGuesses(updatedGuesses);

      if (attempt >= ATTEMPTS_PER_ROUND) {
        setRoundResolved(true);
        setResults((current) => [
          ...current,
          {
            targetId,
            name: targetName,
            correct: false,
            attempts: ATTEMPTS_PER_ROUND,
          },
        ]);
        setStatusMessage(`Out of guesses. The answer was ${targetName}.`);
        return;
      }

      const guessesLeft = ATTEMPTS_PER_ROUND - attempt;
      const hint = buildDirectionHint(clickedFeature, targetFeature);
      setAttempt((current) => current + 1);
      setStatusMessage(
        `Not quite. Target is about ${hint}. ${guessesLeft} guess${guessesLeft === 1 ? '' : 'es'} left.`,
      );
    },
    [
      attempt,
      guessedIds,
      isFinished,
      loadError,
      loading,
      roundGuesses,
      roundResolved,
      targetFeature,
      targetId,
      targetName,
    ],
  );

  const handleFeatureGuess = useCallback(
    (clickedFeature, latLng) => {
      if (loading || loadError || isFinished || roundResolved || !targetFeature || !targetId) {
        return;
      }

      if (!latLng) {
        submitGuess(clickedFeature);
        return;
      }

      const clickPoint = asPointFeature(latLng);
      const uniqueMatches = new Map();

      for (const feature of activeFeatures) {
        const featureId = feature?.properties?.id;
        if (!featureId) {
          continue;
        }

        try {
          if (booleanPointInPolygon(clickPoint, feature)) {
            uniqueMatches.set(featureId, feature);
          }
        } catch {
          continue;
        }
      }

      const matches = [...uniqueMatches.values()];

      if (matches.length <= 1) {
        submitGuess(clickedFeature);
        return;
      }

      const clickedId = clickedFeature?.properties?.id;
      matches.sort((left, right) => {
        const leftId = left?.properties?.id;
        const rightId = right?.properties?.id;

        if (leftId === clickedId && rightId !== clickedId) {
          return -1;
        }
        if (rightId === clickedId && leftId !== clickedId) {
          return 1;
        }

        const leftName = left?.properties?.name ?? '';
        const rightName = right?.properties?.name ?? '';
        return leftName.localeCompare(rightName);
      });

      const firstSelectable = matches.find((feature) => !guessedIds.has(feature?.properties?.id));
      if (!firstSelectable) {
        setOverlapChoices([]);
        setSelectedOverlapId(null);
        setStatusMessage(
          'All overlapping options at this point were already guessed. Click a different area.',
        );
        return;
      }

      setOverlapChoices(matches);
      setSelectedOverlapId(firstSelectable.properties.id);
      setStatusMessage(
        `This point overlaps ${matches.length} territories. Select an option number and confirm your guess.`,
      );
    },
    [
      activeFeatures,
      guessedIds,
      isFinished,
      loadError,
      loading,
      roundResolved,
      submitGuess,
      targetFeature,
      targetId,
    ],
  );

  const handleOverlapOptionSelect = useCallback((featureId) => {
    setSelectedOverlapId(featureId);
  }, []);

  const handleOverlapConfirm = useCallback(() => {
    if (!selectedOverlapId) {
      return;
    }

    const selectedFeature = overlapChoices.find(
      (feature) => feature?.properties?.id === selectedOverlapId,
    );
    if (!selectedFeature) {
      return;
    }

    submitGuess(selectedFeature);
  }, [overlapChoices, selectedOverlapId, submitGuess]);

  const handleOverlapCancel = useCallback(() => {
    setOverlapChoices([]);
    setSelectedOverlapId(null);
    setStatusMessage('Overlap selection canceled. Click the map again to guess.');
  }, []);

  const handleAdvanceRound = useCallback(() => {
    if (!roundResolved) {
      return;
    }

    const isLastRound = currentIndex >= queue.length - 1;
    if (isLastRound) {
      setIsFinished(true);
      setOverlapChoices([]);
      setSelectedOverlapId(null);
      setStatusMessage('Quiz complete.');
      return;
    }

    const nextIndex = currentIndex + 1;
    const nextTargetId = queue[nextIndex];
    const nextTargetName = featureById.get(nextTargetId)?.properties?.name ?? 'Unknown nation';

    setCurrentIndex(nextIndex);
    setAttempt(1);
    setRoundGuesses([]);
    setRoundResolved(false);
    setOverlapChoices([]);
    setSelectedOverlapId(null);
    setStatusMessage(buildPrompt(nextIndex, queue.length, nextTargetName));
  }, [currentIndex, featureById, queue, roundResolved]);

  const handlePronounce = useCallback(() => {
    if (!targetName) {
      return;
    }

    if (!('speechSynthesis' in window)) {
      setStatusMessage('Pronunciation playback is not supported in this browser.');
      return;
    }

    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(targetName);
    utterance.rate = 0.9;
    utterance.pitch = 1;
    window.speechSynthesis.speak(utterance);
  }, [targetName]);

  const handleReviewMissed = useCallback(() => {
    const missedIds = missedResults.map((result) => result.targetId);
    startGame(missedIds);
  }, [missedResults, startGame]);

  const handleDatasetChange = useCallback(
    (event) => {
      const nextDatasetId = event.target.value;
      if (!nextDatasetId || nextDatasetId === selectedDatasetId) {
        return;
      }

      setSelectedDatasetId(nextDatasetId);
      setQueue([]);
      setCurrentIndex(0);
      setAttempt(1);
      setRoundGuesses([]);
      setRoundResolved(false);
      setResults([]);
      setScore(0);
      setIsFinished(false);
      setOverlapChoices([]);
      setSelectedOverlapId(null);
      setStatusMessage('Loading selected dataset...');
    },
    [selectedDatasetId],
  );

  const mapStyle = useCallback(
    (feature) => {
      const featureId = feature?.properties?.id;
      const basePalette = { border: '#3b82f6', fill: '#93c5fd' };

      let border = basePalette.border;
      let fill = basePalette.fill;
      let fillOpacity = 0.22;
      let weight = 1.15;
      let dashArray = undefined;

      if (overlapChoiceIds.has(featureId)) {
        border = '#6366f1';
        fill = '#c7d2fe';
        fillOpacity = 0.35;
        weight = 1.4;
        dashArray = '4 4';
      }

      if (featureId === selectedOverlapId) {
        border = '#7c3aed';
        fill = '#c4b5fd';
        fillOpacity = 0.62;
        weight = 2;
        dashArray = undefined;
      }

      if (guessedIds.has(featureId) && featureId !== targetId) {
        border = '#b91c1c';
        fill = '#fca5a5';
        fillOpacity = 0.55;
        weight = 1.3;
      }

      if (featureId === targetId && roundResolved) {
        border = '#166534';
        fill = '#4ade80';
        fillOpacity = 0.62;
        weight = 1.5;
      }

      return {
        color: border,
        fillColor: fill,
        fillOpacity,
        weight,
        dashArray,
      };
    },
    [guessedIds, overlapChoiceIds, roundResolved, selectedOverlapId, targetId],
  );

  const onEachFeature = useCallback(
    (feature, layer) => {
      layer.on({
        click: (event) => handleFeatureGuess(feature, event?.latlng),
      });
    },
    [handleFeatureGuess],
  );

  return (
    <div className="app-shell">
      <header className="top-bar">
        <div>
          <h1>NationsLearner BC</h1>
          <p className="subtitle">
            Click the right First Nations territory on an unlabeled map, with optional city markers.
          </p>
        </div>

        <div className="top-controls">
          <label className="city-toggle" htmlFor="major-cities-toggle">
            <input
              id="major-cities-toggle"
              type="checkbox"
              checked={showMajorCities}
              onChange={(event) => setShowMajorCities(event.target.checked)}
            />
            Show major cities
          </label>
        </div>

        {selectedDatasetMeta ? (
          <div className="dataset-description">
            <div className="dataset-heading-row">
              <label className="dataset-picker" htmlFor="dataset-select">
                Selected dataset
                <select
                  id="dataset-select"
                  value={selectedDatasetId}
                  onChange={handleDatasetChange}
                  disabled={datasetCatalog.length === 0}
                >
                  {datasetCatalog.map((dataset) => (
                    <option key={dataset.id ?? dataset.displayName} value={dataset.id}>
                      {dataset.displayName}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <p className="dataset-copy">{selectedDatasetMeta.description}</p>
            <p className="dataset-meta">
              {selectedDatasetMeta.groupedFeatureCount} entries from {selectedDatasetMeta.sourceLabel}.{' '}
              <a href={selectedDatasetMeta.metadataUrl} target="_blank" rel="noreferrer">
                Dataset details
              </a>
            </p>
          </div>
        ) : null}
      </header>

      {loading ? (
        <section className="card">
          <p>{loadingMessage}</p>
        </section>
      ) : null}

      {!loading && loadError ? (
        <section className="card error">
          <p>{loadError}</p>
        </section>
      ) : null}

      {!loading && !loadError ? (
        <>
          <section className="card prompt-card">
            {!isFinished ? (
              <>
                <div className="prompt-title-row">
                  <p className="label">Find this nation</p>
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={handlePronounce}
                    disabled={!targetName}
                  >
                    Pronounce
                  </button>
                </div>

                <h2>{targetName || '---'}</h2>

                <div className="stats-row">
                  <p>
                    Round <strong>{Math.min(currentIndex + 1, queue.length)}</strong> / {queue.length}
                  </p>
                  <p>
                    Attempt <strong>{attempt}</strong> / {ATTEMPTS_PER_ROUND}
                  </p>
                  <p>
                    Score <strong>{score}</strong> / {maxScore}
                  </p>
                </div>

                <p className={roundResolved ? 'status resolved' : 'status'}>{statusMessage}</p>

                {overlapChoices.length > 1 ? (
                  <div className="overlap-picker">
                    <p className="label">Overlapping area</p>
                    <p className="overlap-copy">
                      Multiple territories share this point. Choose a numbered option and confirm.
                    </p>
                    <div className="overlap-options">
                      {overlapChoices.map((feature, index) => {
                        const optionId = feature?.properties?.id;
                        const alreadyGuessed = guessedIds.has(optionId);
                        const isSelected = optionId === selectedOverlapId;
                        const key = optionId ?? `overlap-option-${index}`;

                        return (
                          <button
                            key={key}
                            type="button"
                            className={isSelected ? 'overlap-option active' : 'overlap-option'}
                            onClick={() => handleOverlapOptionSelect(optionId)}
                            disabled={!optionId || alreadyGuessed}
                          >
                            Option {index + 1}
                            {alreadyGuessed ? ' (already guessed)' : ''}
                          </button>
                        );
                      })}
                    </div>
                    <div className="overlap-actions">
                      <button
                        type="button"
                        className="primary-button overlap-confirm"
                        onClick={handleOverlapConfirm}
                        disabled={!selectedOverlapId}
                      >
                        Submit selected option
                      </button>
                      <button
                        type="button"
                        className="secondary-button overlap-cancel"
                        onClick={handleOverlapCancel}
                      >
                        Cancel selection
                      </button>
                    </div>
                    <p className="overlap-note">
                      Selected option is highlighted in purple on the map.
                    </p>
                  </div>
                ) : null}

                {roundResolved ? (
                  <button type="button" className="primary-button" onClick={handleAdvanceRound}>
                    {currentIndex >= queue.length - 1 ? 'View results' : 'Next nation'}
                  </button>
                ) : null}
              </>
            ) : (
              <>
                <h2>Final Score: {score}</h2>
                <div className="stats-row final">
                  <p>
                    Accuracy <strong>{accuracy}%</strong>
                  </p>
                  <p>
                    Correct <strong>{correctCount}</strong> / {queue.length}
                  </p>
                  <p>
                    First-try hits <strong>{firstTryCount}</strong>
                  </p>
                </div>

                <div className="result-actions">
                  <button type="button" className="primary-button" onClick={() => startGame()}>
                    Play again
                  </button>
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={handleReviewMissed}
                    disabled={missedResults.length === 0}
                  >
                    Review missed ({missedResults.length})
                  </button>
                </div>

                <p className="status resolved">{statusMessage}</p>

                <div className="missed-card">
                  <p className="label">Missed nations</p>
                  {missedResults.length === 0 ? (
                    <p>Perfect run. Nothing missed.</p>
                  ) : (
                    <ul>
                      {missedResults.map((entry, index) => (
                        <li key={`${entry.targetId ?? 'missed'}-${index}`}>{entry.name}</li>
                      ))}
                    </ul>
                  )}
                </div>
              </>
            )}
          </section>

          <section className="map-card">
            <MapContainer
              className="map"
              bounds={BC_BOUNDS}
              boundsOptions={{ padding: [20, 20] }}
              minZoom={4}
              maxZoom={12}
              scrollWheelZoom
            >
              <TileLayer
                attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, tiles &copy; <a href="https://carto.com/">CARTO</a>'
                url="https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png"
              />
              {activeDataset ? (
                <GeoJSON
                  key={`${selectedDatasetId}-${currentIndex}-${attempt}-${roundGuesses.length}-${roundResolved}-${isFinished}`}
                  data={activeDataset}
                  style={mapStyle}
                  onEachFeature={onEachFeature}
                />
              ) : null}
              {showMajorCities
                ? MAJOR_CITIES.map((city) => (
                    <CircleMarker
                      key={city.name}
                      center={city.coordinates}
                      radius={5}
                      pathOptions={{
                        color: '#0f172a',
                        weight: 1,
                        fillColor: '#f97316',
                        fillOpacity: 0.95,
                      }}
                    >
                      <Tooltip permanent direction="top" offset={[0, -6]} className="city-tooltip">
                        {city.name}
                      </Tooltip>
                    </CircleMarker>
                  ))
                : null}
            </MapContainer>
          </section>

          <footer className="data-note">
            {selectedDatasetMeta
              ? `Using ${selectedDatasetMeta.sourceLabel}.`
              : 'Select a dataset to begin.'}
          </footer>
        </>
      ) : null}
    </div>
  );
}

export default App;
