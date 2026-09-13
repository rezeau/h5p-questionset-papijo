'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');

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

test('library manifest identifies QuestionSetPapiJo 1.21.4', () => {
  const library = readJson('library.json');

  assert.equal(library.machineName, 'H5P.QuestionSetPapiJo');
  assert.deepEqual(
    [library.majorVersion, library.minorVersion, library.patchVersion],
    [1, 21, 4]
  );
});

test('question-library whitelist retains the complete 1.21.4 baseline', () => {
  const options = getQuestionLibraryWhitelist();

  assert.deepEqual(options, BASELINE_QUESTION_LIBRARY_WHITELIST);
  assert.equal(options.includes('H5P.DragTextPapiJo 1.2'), true);
  assert.equal(options.includes('H5P.DragTextPapiJo 1.3'), false);
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
const h5pCorePath = h5pCoreCandidates.find((candidate) =>
  fs.existsSync(path.join(candidate, 'h5p-version.js')) &&
  fs.existsSync(path.join(candidate, 'h5p-content-upgrade-process.js'))
);
const dragTextRepoPath = dragTextRepoCandidates.find((candidate) =>
  fs.existsSync(path.join(candidate, 'library.json')) &&
  fs.existsSync(path.join(candidate, '.git'))
);

test(
  'real H5P upgrade recursively moves the released DragTextPapiJo 1.1 baseline to 1.2',
  {
    skip: !h5pCorePath || !dragTextRepoPath ?
      'H5P core upgrade scripts or the DragTextPapiJo repository are unavailable' : false
  },
  async () => {
    const fixture = {
      library: 'H5P.QuestionSetPapiJo 1.20',
      params: {
        questions: [
          {
            library: 'H5P.DragTextPapiJo 1.1',
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
    const normalizedDragTextRepoPath = dragTextRepoPath.replace(/\\/g, '/');
    const dragTextSemantics = JSON.parse(execFileSync(
      'git',
      [
        '-c',
        `safe.directory=${normalizedDragTextRepoPath}`,
        '-C',
        dragTextRepoPath,
        'show',
        'v1.2.0:semantics.json'
      ],
      { encoding: 'utf8' }
    ));
    const libraries = new Map([
      ['H5P.QuestionSetPapiJo 1.21', {
        name: 'H5P.QuestionSetPapiJo',
        semantics: questionSetSemantics
      }],
      ['H5P.DragTextPapiJo 1.2', {
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
        new context.H5P.Version('1.20'),
        new context.H5P.Version('1.21'),
        JSON.stringify({ params: fixture.params, metadata: {} }),
        'questionset-baseline',
        loadLibrary,
        (error, upgraded) => error ? reject(error) : resolve(JSON.parse(upgraded))
      );
    });

    assert.deepEqual(fixture, before);
    assert.equal(result.params.questions[0].library, 'H5P.DragTextPapiJo 1.2');
    assert.deepEqual(result.params.questions[0].params, childParamsBefore);
    assert.equal(
      result.params.questions[0].subContentId,
      fixture.params.questions[0].subContentId
    );
    assert.equal(fs.existsSync(path.join(root, 'upgrades.js')), false);
  }
);
