import React from 'react';
import PropTypes from 'prop-types';
import Terser from 'terser';

const generateScript = ({ segmentWriteKey }) => `
(function(writeKey) {
  Tessen.load(["Segment", "NewRelic"], {
    Segment: {
      identifiable: true,
      writeKey: writeKey
    }
  })

  Tessen.identify({})
})('${segmentWriteKey}')
`;

const TessenHydrationScriptTag = ({ config }) => {
  const { minify } = config;
  const tessenScript = generateScript(config);

  return (
    <script
      dangerouslySetInnerHTML={{
        __html: minify ? Terser.minify(tessenScript).code || '' : tessenScript,
      }}
    />
  );
};

TessenHydrationScriptTag.propTypes = {
  config: PropTypes.shape({
    minify: PropTypes.bool.isRequired,
    segmentWriteKey: PropTypes.string,
  }).isRequired,
};

export default TessenHydrationScriptTag;
