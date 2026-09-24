'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');

const BASELINE_QUESTION_LIBRARY_WHITELIST = [
  'H5P.Blanks 1.14',
  'H5P.AdvancedBlanksPapiJo 1.4',
  'H5P.DragQuestionPapiJo 1.14',
  'H5P.DragTextPapiJo 1.2',
  'H5P.Essay 1.6',
  'H5P.MarkTheWordsPapiJo 1.2',
  'H5P.MultiChoice 1.16',
  'H5P.MultiMediaChoicePapiJo 0.4',
  'H5P.TrueFalse 1.8'
];

const readJson = (file) => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));

const getQuestionLibraryWhitelist = () => {
  const semantics = readJson('semantics.json');
  const questions = semantics.find((field) => field.name === 'questions');

  assert.ok(questions, 'questions semantics field is missing');
  assert.equal(questions.field.type, 'library');
  assert.ok(Array.isArray(questions.field.options));

  return questions.field.options;
};

test('library manifest identifies QuestionSetPapiJo 1.23.0', () => {
  const library = readJson('library.json');

  assert.equal(library.machineName, 'H5P.QuestionSetPapiJo');
  assert.deepEqual(
    [library.majorVersion, library.minorVersion, library.patchVersion],
    [1, 23, 0]
  );
});

test('question-library whitelist adds only ScaleQuestion 0.2 and preserves version 1.23.0', () => {
  const options = getQuestionLibraryWhitelist();
  const expected = [
    ...BASELINE_QUESTION_LIBRARY_WHITELIST.map((option) =>
      option === 'H5P.DragTextPapiJo 1.2' ? 'H5P.DragTextPapiJo 1.3' : option
    ),
    'H5P.ScaleQuestion 0.2'
  ];
  const library = readJson('library.json');

  assert.deepEqual(options, expected);
  assert.equal(options.includes('H5P.ScaleQuestion 0.2'), true);
  assert.equal(options.includes('H5P.DragTextPapiJo 1.3'), true);
  assert.equal(options.includes('H5P.DragTextPapiJo 1.2'), false);
  assert.deepEqual(
    [library.majorVersion, library.minorVersion, library.patchVersion],
    [1, 23, 0]
  );
});

const h5pCoreCandidates = [
  process.env.H5P_CORE_JS_PATH,
  'C:\\wamp64\\www\\wp-h5p\\wp-content\\plugins\\h5p\\h5p-php-library\\js',
  'C:\\my_first_h5p_environment\\libraries\\h5p-php-library\\js'
].filter(Boolean);
const dragTextRepoCandidates = [
  process.env.H5P_DRAGTEXT_PAPIJO_REPO,
  path.resolve(root, '..', 'papi-jo-h5p-dragtext')
].filter(Boolean);
const scaleQuestionRepoCandidates = [
  process.env.H5P_SCALEQUESTION_REPO,
  path.resolve(root, '..', 'papi-jo-h5p-scale-question')
].filter(Boolean);
const h5pCorePath = h5pCoreCandidates.find((candidate) =>
  fs.existsSync(path.join(candidate, 'h5p-version.js')) &&
  fs.existsSync(path.join(candidate, 'h5p-content-upgrade-process.js'))
);
const dragTextRepoPath = dragTextRepoCandidates.find((candidate) =>
  fs.existsSync(path.join(candidate, 'library.json')) &&
  fs.existsSync(path.join(candidate, 'semantics.json'))
);
const scaleQuestionRepoPath = scaleQuestionRepoCandidates.find((candidate) =>
  fs.existsSync(path.join(candidate, 'library.json')) &&
  fs.existsSync(path.join(candidate, 'semantics.json')) &&
  fs.existsSync(path.join(candidate, 'upgrades.js'))
);

test(
  'real H5P upgrade recursively moves DragTextPapiJo 1.2 to 1.3 under QuestionSetPapiJo 1.22',
  {
    skip: !h5pCorePath || !dragTextRepoPath ?
      'H5P core upgrade scripts or the DragTextPapiJo repository are unavailable' : false
  },
  async () => {
    const fixture = {
      library: 'H5P.QuestionSetPapiJo 1.21',
      params: {
        questions: [
          {
            library: 'H5P.DragTextPapiJo 1.2',
            params: {
              taskDescription: 'QuestionSetPapiJo recursive-upgrade baseline',
              textField: 'A *preserved::Text tooltip* value.',
              distractors: '',
              behaviour: {
                instantFeedback: false,
                enableRetry: true
              }
            },
            subContentId: '64c42f03-5e5a-47d5-a082-b59a60dbe511'
          }
        ]
      }
    };
    const before = structuredClone(fixture);
    const childParamsBefore = structuredClone(fixture.params.questions[0].params);
    const context = vm.createContext({ H5P: {}, H5PUpgrades: {}, console, setTimeout });

    for (const file of ['h5p-version.js', 'h5p-content-upgrade-process.js']) {
      vm.runInContext(
        fs.readFileSync(path.join(h5pCorePath, file), 'utf8'),
        context,
        { filename: file }
      );
    }

    const questionSetSemantics = readJson('semantics.json');
    const dragTextLibrary = JSON.parse(fs.readFileSync(
      path.join(dragTextRepoPath, 'library.json'),
      'utf8'
    ));
    const dragTextSemantics = JSON.parse(fs.readFileSync(
      path.join(dragTextRepoPath, 'semantics.json'),
      'utf8'
    ));
    assert.deepEqual(
      [dragTextLibrary.machineName, dragTextLibrary.majorVersion, dragTextLibrary.minorVersion],
      ['H5P.DragTextPapiJo', 1, 3]
    );
    const libraries = new Map([
      ['H5P.QuestionSetPapiJo 1.22', {
        name: 'H5P.QuestionSetPapiJo',
        semantics: questionSetSemantics
      }],
      ['H5P.DragTextPapiJo 1.3', {
        name: 'H5P.DragTextPapiJo',
        semantics: dragTextSemantics
      }]
    ]);
    const loadLibrary = (name, version, done) => {
      const library = libraries.get(`${name} ${version.major}.${version.minor}`);
      setTimeout(
        () => done(library ? null : { type: 'libraryMissing', library: name }, library),
        0
      );
    };

    const result = await new Promise((resolve, reject) => {
      new context.H5P.ContentUpgradeProcess(
        'H5P.QuestionSetPapiJo',
        new context.H5P.Version('1.21'),
        new context.H5P.Version('1.22'),
        JSON.stringify({ params: fixture.params, metadata: {} }),
        'questionset-baseline',
        loadLibrary,
        (error, upgraded) => error ? reject(error) : resolve(JSON.parse(upgraded))
      );
    });

    assert.deepEqual(fixture, before);
    assert.equal(result.params.questions[0].library, 'H5P.DragTextPapiJo 1.3');
    assert.deepEqual(result.params.questions[0].params, childParamsBefore);
    assert.equal(
      result.params.questions[0].subContentId,
      fixture.params.questions[0].subContentId
    );
    assert.equal(fs.existsSync(path.join(root, 'upgrades.js')), false);
  }
);

test(
  'real H5P upgrade recursively moves ScaleQuestion 0.1 to 0.2 under QuestionSetPapiJo 1.23',
  {
    skip: !h5pCorePath || !scaleQuestionRepoPath ?
      'H5P core upgrade scripts or the ScaleQuestion repository are unavailable' : false
  },
  async () => {
    const fixture = {
      library: 'H5P.QuestionSetPapiJo 1.22',
      params: {
        progressType: 'dots',
        passPercentage: 70,
        disableBackwardsNavigation: true,
        randomQuestions: false,
        questions: [
          {
            library: 'H5P.ScaleQuestion 0.1',
            params: {
              question: '<p>Choose the value closest to the target.</p>',
              scaleMode: 'numerical',
              minimum: -5,
              maximum: 15,
              step: 0.5,
              correctValue: 7.5,
              acceptedTolerance: 1,
              maxAttempts: 3,
              orientation: 'vertical',
              behaviour: {
                autoCheck: false,
                enableRetry: true,
                enableSolutionsButton: false
              },
              l10n: {
                scaleLabel: 'Authored numerical scale',
                selectedValue: 'Chosen value: @value',
                checkAnswer: 'Validate',
                tryAgain: 'Try once more',
                showSolution: 'Reveal answer',
                correctFeedback: 'That is correct.'
              }
            },
            metadata: {
              contentType: 'Scale Question',
              title: 'Preserved scale title',
              license: 'CC BY',
              authors: [{ name: 'Test Author', role: 'Author' }],
              changes: []
            },
            subContentId: '7a97db87-9422-4bd8-867d-991eb2ab9f87'
          },
          {
            library: 'H5P.TrueFalse 1.8',
            params: {
              question: '<p>This sibling must remain unchanged.</p>',
              correct: 'true',
              behaviour: {
                enableRetry: false,
                enableSolutionsButton: true,
                enableCheckButton: true
              }
            },
            metadata: {
              contentType: 'True/False Question',
              title: 'Preserved sibling title',
              license: 'U'
            },
            subContentId: '3ddf6387-6a83-40ad-b0c2-fbafd21f33eb'
          }
        ],
        override: {
          checkButton: false,
          retryButton: 'off',
          showSolutionButton: 'on'
        },
        endGame: {
          showResultPage: true,
          showSolutionButton: true,
          showRetryButton: false,
          overallFeedback: [{ from: 0, to: 100, feedback: 'Preserved feedback' }]
        }
      },
      metadata: {
        title: 'QuestionSet recursive ScaleQuestion fixture',
        defaultLanguage: 'fr',
        license: 'CC BY-SA'
      }
    };
    const before = structuredClone(fixture);
    const scaleQuestionBefore = structuredClone(fixture.params.questions[0]);
    const siblingBefore = structuredClone(fixture.params.questions[1]);
    const expectedParams = structuredClone(fixture.params);
    expectedParams.questions[0].library = 'H5P.ScaleQuestion 0.2';
    const context = vm.createContext({ H5P: {}, H5PUpgrades: {}, console, setTimeout });

    for (const file of ['h5p-version.js', 'h5p-content-upgrade-process.js']) {
      vm.runInContext(
        fs.readFileSync(path.join(h5pCorePath, file), 'utf8'),
        context,
        { filename: file }
      );
    }
    vm.runInContext(
      fs.readFileSync(path.join(scaleQuestionRepoPath, 'upgrades.js'), 'utf8'),
      context,
      { filename: path.join(scaleQuestionRepoPath, 'upgrades.js') }
    );

    const questionSetSemantics = readJson('semantics.json');
    const scaleQuestionLibrary = JSON.parse(fs.readFileSync(
      path.join(scaleQuestionRepoPath, 'library.json'),
      'utf8'
    ));
    const scaleQuestionSemantics = JSON.parse(fs.readFileSync(
      path.join(scaleQuestionRepoPath, 'semantics.json'),
      'utf8'
    ));
    assert.deepEqual(
      [
        scaleQuestionLibrary.machineName,
        scaleQuestionLibrary.majorVersion,
        scaleQuestionLibrary.minorVersion
      ],
      ['H5P.ScaleQuestion', 0, 2]
    );
    assert.equal(
      typeof context.H5PUpgrades['H5P.ScaleQuestion'][0][2].contentUpgrade,
      'function'
    );

    const libraries = new Map([
      ['H5P.QuestionSetPapiJo 1.23', {
        name: 'H5P.QuestionSetPapiJo',
        semantics: questionSetSemantics
      }],
      ['H5P.ScaleQuestion 0.2', {
        name: 'H5P.ScaleQuestion',
        semantics: scaleQuestionSemantics,
        upgradesScript: 'upgrades.js'
      }]
    ]);
    const loadRequests = [];
    const loadLibrary = (name, version, done) => {
      const key = `${name} ${version.major}.${version.minor}`;
      loadRequests.push(key);
      const library = libraries.get(key);
      setTimeout(
        () => done(library ? null : { type: 'libraryMissing', library: name }, library),
        0
      );
    };

    const result = await new Promise((resolve, reject) => {
      new context.H5P.ContentUpgradeProcess(
        'H5P.QuestionSetPapiJo',
        new context.H5P.Version('1.22'),
        new context.H5P.Version('1.23'),
        JSON.stringify({ params: fixture.params, metadata: fixture.metadata }),
        'questionset-scale-question-upgrade',
        loadLibrary,
        (error, upgraded) => error ? reject(error) : resolve(JSON.parse(upgraded))
      );
    });

    assert.equal(loadRequests[0], 'H5P.QuestionSetPapiJo 1.23');
    assert.equal(loadRequests.includes('H5P.ScaleQuestion 0.2'), true);
    assert.equal(result.params.questions[0].library, 'H5P.ScaleQuestion 0.2');
    assert.deepEqual(result.params.questions[0].params, scaleQuestionBefore.params);
    assert.deepEqual(result.params.questions[0].metadata, scaleQuestionBefore.metadata);
    assert.equal(result.params.questions[0].subContentId, scaleQuestionBefore.subContentId);
    assert.deepEqual(result.params.questions[1], siblingBefore);
    assert.deepEqual(result.metadata, fixture.metadata);
    assert.deepEqual(result.params, expectedParams);
    assert.deepEqual(fixture, before);
    assert.equal(fs.existsSync(path.join(root, 'upgrades.js')), false);
  }
);
