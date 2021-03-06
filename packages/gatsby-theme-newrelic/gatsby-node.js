const fs = require('fs');
const path = require('path');
const { createFilePath } = require('gatsby-source-filesystem');
const {
  defaultLocale,
  withDefaults,
  themeNamespace,
} = require('./src/utils/defaultOptions');
const createRelatedResourceNode = require('./src/utils/related-resources/createRelatedResourceNode');
const getRelatedResources = require('./src/utils/related-resources/fetchRelatedResources');
const getTessenConfig = require('./src/utils/config/tessen');
const { TESSEN_PATH } = require('./gatsby/constants');
const { getResolvedEnv } = require('./src/utils/config');

let writeableRelatedResourceData = {};

const uniq = (arr) => [...new Set(arr)];

const ANNOUNCEMENTS_DIRECTORY = 'src/announcements';
const DEFAULT_BRANCH = 'main';

const matchesLocale = (path, locale) =>
  new RegExp(`^\\/?${locale}(?=$|\\/)`).test(path);

exports.onPreInit = (_, themeOptions) => {
  const { i18n, relatedResources = {}, tessen } = themeOptions;

  if (i18n && !i18n.translationsPath) {
    throw new Error(
      "[@newrelic/gatsby-theme-newrelic] Please define an 'i18n.translationsPath' option"
    );
  }

  if (relatedResources.swiftype) {
    validateSwiftypeOptions(relatedResources.swiftype);
  }

  if (tessen) {
    validateTessenOptions(tessen);
  }
};

exports.onPreBootstrap = ({ reporter, store }, themeOptions) => {
  const { program } = store.getState();
  const tessenLibrary = path.join(
    program.directory,
    'static',
    path.basename(TESSEN_PATH)
  );
  const imagePath = path.join(program.directory, 'src/images');
  const announcementsPath = path.join(
    program.directory,
    ANNOUNCEMENTS_DIRECTORY
  );
  const { relatedResources = {}, tessen } = themeOptions;

  createDirectory(imagePath, {
    reporter,
    message: 'creating the images directory',
  });

  createDirectory(announcementsPath, {
    reporter,
    message: 'creating the announcements directory',
  });

  if (themeOptions.i18n) {
    const { i18n } = withDefaults(themeOptions);

    [defaultLocale]
      .concat(i18n.additionalLocales || [])
      .forEach(({ locale }) => {
        i18n.i18nextOptions.ns
          .filter((ns) => ns !== themeNamespace)
          .forEach((ns) => {
            createFile(
              path.join(i18n.translationsPath, locale, `${ns}.json`),
              '{}',
              {
                reporter,
                message: `creating the ${locale}/${ns}.json file`,
              }
            );
          });
      });
  }

  if (relatedResources.swiftype) {
    const { resultsPath } = relatedResources.swiftype;

    createFile(resultsPath, '{}', {
      reporter,
      message: 'creating an empty related resources file',
    });

    writeableRelatedResourceData = JSON.parse(
      fs.readFileSync(resultsPath, { encoding: 'utf-8' })
    );
  }

  if (tessen && !fs.existsSync(tessenLibrary)) {
    createDirectory(path.dirname(tessenLibrary));

    fs.copyFileSync(TESSEN_PATH, tessenLibrary);

    reporter.info(
      '[@newrelic/gatsby-theme-newrelic] adding Tessen library. Please commit this file.'
    );
  }
};

exports.createSchemaCustomization = ({ actions }) => {
  const { createTypes } = actions;

  createTypes(
    fs.readFileSync(path.resolve(__dirname, './gatsby/type-defs.graphql'), {
      encoding: 'utf-8',
    })
  );
};

exports.sourceNodes = (
  { actions, createNodeId, createContentDigest },
  themeOptions
) => {
  const { i18n, relatedResources } = withDefaults(themeOptions);
  const { createNode } = actions;
  const tessen = getTessenConfig(themeOptions);
  const env = getResolvedEnv(themeOptions);

  i18n.locales.forEach((locale) => {
    const isDefault = locale.locale === defaultLocale.locale;

    const data = {
      ...locale,
      isDefault,
      localizedPath: isDefault ? '' : locale.locale,
    };

    createNode({
      ...data,
      id: createNodeId(`Locale-${locale.locale}`),
      parent: null,
      children: [],
      internal: {
        type: 'Locale',
        contentDigest: createContentDigest(data),
      },
    });
  });

  const config = {
    env,
    relatedResources: {
      labels: Object.entries(relatedResources.labels).map(
        ([baseUrl, label]) => ({
          baseUrl,
          label,
        })
      ),
    },
    tessen: tessen
      ? { product: tessen.product, subproduct: tessen.subproduct }
      : null,
  };

  createNode({
    ...config,
    id: createNodeId('@newrelic/gatsby-theme-newrelic:config'),
    parent: null,
    children: [],
    internal: {
      type: 'NewRelicThemeConfig',
      contentDigest: createContentDigest(config),
      content: JSON.stringify(config),
    },
  });
};

exports.createResolvers = ({ createResolvers }, themeOptions) => {
  const { layout = {} } = themeOptions;

  const defaultUtmSource = {
    'https://developer.newrelic.com': 'developer-site',
    'https://opensource.newrelic.com': 'opensource-site',
    'https://docs.newrelic.com': 'docs-site',
  };

  createResolvers({
    Site: {
      layout: {
        type: 'SiteLayout',
        resolve: () => layout,
      },
    },
    SiteSiteMetadata: {
      utmSource: {
        resolve: ({ siteUrl, utmSource }) =>
          utmSource || defaultUtmSource[siteUrl],
      },
      branch: {
        resolve: ({ branch }) => branch || DEFAULT_BRANCH,
      },
      contributingUrl: {
        resolve: ({ contributingUrl, branch, repository }) => {
          if (contributingUrl !== undefined) {
            return contributingUrl;
          }

          return repository
            ? `${repository}/blob/${branch || DEFAULT_BRANCH}/CONTRIBUTING.md`
            : null;
        },
      },
    },
    Mdx: {
      relatedResources: {
        args: {
          limit: {
            type: 'Int',
            defaultValue: 5,
          },
        },
        type: ['RelatedResource!'],
        resolve: (source, args, context) => {
          const { limit } = args;

          return context.nodeModel
            .getNodesByIds({ ids: source.children })
            .slice(0, Math.max(limit, 0));
        },
      },
    },
  });
};

exports.onCreateBabelConfig = ({ actions }, themeOptions) => {
  const { setBabelPlugin } = actions;
  const { prism = {} } = themeOptions;

  setBabelPlugin({
    name: 'babel-plugin-prismjs',
    options: {
      languages: uniq([
        'css',
        'hcl',
        'javascript',
        'json',
        'jsx',
        'ruby',
        'shell',
        'sql',
        'graphql',
        'sass',
        'scss',
        'yaml',
        ...(prism.languages || []),
      ]),
    },
  });
};

exports.onCreateNode = async (utils, themeOptions) => {
  const { relatedResources } = withDefaults(themeOptions);
  const { node, actions } = utils;
  const { createNodeField } = actions;

  if (['Mdx', 'MarkdownRemark'].includes(node.internal.type)) {
    createNodeField({
      node,
      name: 'fileRelativePath',
      value: getFileRelativePath(node.fileAbsolutePath),
    });
  }

  await createRelatedResources(utils, relatedResources);
};

exports.onCreatePage = ({ page, actions }, themeOptions) => {
  const { createPage } = actions;
  const { i18n = {} } = themeOptions;
  const { additionalLocales = [] } = i18n;

  if (!page.context.fileRelativePath) {
    page.context.fileRelativePath = getFileRelativePath(page.componentPath);

    createPage(page);
  }

  if (!page.context.locale) {
    const { locale } =
      additionalLocales.find(({ locale }) =>
        matchesLocale(page.path, locale)
      ) || defaultLocale;

    page.context.locale = locale;

    createPage(page);
  }

  if (
    !page.path.match(/404/) &&
    page.context.fileRelativePath.includes('src/pages/')
  ) {
    additionalLocales.forEach(({ locale }) => {
      if (!matchesLocale(page.path, locale)) {
        createPage({
          ...page,
          path: path.join('/', locale, page.path),
          context: {
            ...page.context,
            locale,
          },
        });
      }
    });
  }
};

exports.onCreateWebpackConfig = ({ actions, plugins }, themeOptions) => {
  const { i18n } = themeOptions;

  actions.setWebpackConfig({
    externals: {
      tessen: 'Tessen',
    },
    plugins: [
      plugins.define({
        GATSBY_THEME_NEWRELIC_I18N_PATH: JSON.stringify(
          (i18n && i18n.translationsPath) || ''
        ),
      }),
    ],
  });
};

exports.onPostBootstrap = (_, themeOptions) => {
  const {
    relatedResources: {
      swiftype: { refetch, resultsPath },
    },
  } = withDefaults(themeOptions);

  if (refetch && resultsPath) {
    fs.writeFileSync(
      resultsPath,
      JSON.stringify(writeableRelatedResourceData, null, 2)
    );
  }
};

const createDirectory = (directory, { reporter, message } = {}) => {
  if (fs.existsSync(directory)) {
    return;
  }

  if (message) {
    reporter.info(`[@newrelic/gatsby-theme-newrelic] ${message}`);
  }

  fs.mkdirSync(directory, { recursive: true });
};

const createFile = (filepath, data, { reporter, message } = {}) => {
  if (fs.existsSync(filepath)) {
    return;
  }

  if (message) {
    reporter.info(`[@newrelic/gatsby-theme-newrelic] ${message}`);
  }

  createDirectory(path.dirname(filepath));
  fs.writeFileSync(filepath, data, 'utf-8');
};

const createRelatedResources = async (
  {
    node,
    actions,
    createContentDigest,
    getNodesByType,
    getNode,
    createNodeId,
    reporter,
  },
  options
) => {
  const { swiftype } = options;
  const { createNode, createParentChildLink } = actions;

  if (
    node.internal.type !== 'Mdx' ||
    node.fileAbsolutePath.includes(ANNOUNCEMENTS_DIRECTORY)
  ) {
    return;
  }

  const { frontmatter = {} } = node;

  const resources = frontmatter.resources || [];

  resources.forEach((resource) => {
    const child = createRelatedResourceNode({
      parent: node.id,
      resource,
      createContentDigest,
      createNode,
      createNodeId,
    });

    createParentChildLink({ parent: node, child: child });
  });

  const { getSlug, filter = () => true } = swiftype || {};

  const slug = getSlug
    ? getSlug({ node })
    : createFilePath({ node, getNode, trailingSlash: false });

  if (!swiftype || !filter({ node, slug })) {
    return;
  }

  const [
    {
      siteMetadata: { siteUrl },
    },
  ] = getNodesByType('Site');

  const swiftypeResources = await getRelatedResources(
    { node, slug, siteUrl, reporter },
    swiftype
  );

  writeableRelatedResourceData[slug] = swiftypeResources;

  swiftypeResources.forEach((resource) => {
    const child = createRelatedResourceNode({
      parent: node.id,
      resource,
      createContentDigest,
      createNode,
      createNodeId,
    });

    createParentChildLink({ parent: node, child: child });
  });
};

const validateSwiftypeOptions = (swiftypeOptions) => {
  const { resultsPath, engineKey } = swiftypeOptions;

  if (!resultsPath) {
    throw new Error(
      "You have enabled swiftype searches, but the 'resultsPath' is not defined. Please define a 'relatedResources.swiftype.resultsPath' option"
    );
  }

  if (!engineKey) {
    throw new Error(
      "You have enabled swiftype searches, but the 'engineKey' is missing. Please define a 'relatedResources.swiftype.engineKey' option"
    );
  }
};

const validateTessenOptions = (tessenOptions) => {
  const { segmentWriteKey } = tessenOptions;

  if (!segmentWriteKey) {
    throw new Error(
      "You have enabled Tessen, but the 'segmentWriteKey' is missing. Please define a 'tessen.segmentWriteKey' option"
    );
  }
};

const getFileRelativePath = (absolutePath) =>
  absolutePath.replace(`${process.cwd()}/`, '');
