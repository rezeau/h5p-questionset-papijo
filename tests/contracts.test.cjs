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

test('library manifest identifies QuestionSetPapiJo 1.22.2', () => {
  const library = readJson('library.json');

  assert.equal(library.machineName, 'H5P.QuestionSetPapiJo');
  assert.deepEqual(
    [library.majorVersion, library.minorVersion, library.patchVersion],
    [1, 22, 2]
  );
});

test('question-library whitelist changes only DragTextPapiJo 1.2 to 1.3', () => {
  const options = getQuestionLibraryWhitelist();
  const expected = BASELINE_QUESTION_LIBRARY_WHITELIST.map((option) =>
    option === 'H5P.DragTextPapiJo 1.2' ? 'H5P.DragTextPapiJo 1.3' : option
  );

  assert.deepEqual(options, expected);
  assert.equal(options.includes('H5P.DragTextPapiJo 1.3'), true);
  assert.equal(options.includes('H5P.DragTextPapiJo 1.2'), false);
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
  fs.existsSync(path.join(candidate, 'semantics.json'))
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
