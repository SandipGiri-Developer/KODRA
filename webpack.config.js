//@ts-check

'use strict';

const path = require('path');
const fs = require('fs');

//@ts-check
/** @typedef {import('webpack').Configuration} WebpackConfig **/

/** @type WebpackConfig */
const extensionConfig = {
  target: 'node', // VS Code extensions run in a Node.js-context 📖 -> https://webpack.js.org/configuration/node/
	mode: 'none', // this leaves the source code as close as possible to the original (when packaging we set this to 'production')

  entry: './src/extension.ts', // the entry point of this extension, 📖 -> https://webpack.js.org/configuration/entry-context/
  output: {
    // the bundle is stored in the 'dist' folder (check package.json), 📖 -> https://webpack.js.org/configuration/output/
    path: path.resolve(__dirname, 'dist'),
    filename: 'extension.js',
    libraryTarget: 'commonjs'
  },
  externals: {
    vscode: 'commonjs vscode' // the vscode-module is created on-the-fly and must be excluded. Add other modules that cannot be webpack'ed, 📖 -> https://webpack.js.org/configuration/externals/
    // modules added here also need to be added in the .vscodeignore file
  },
  resolve: {
    // support reading TypeScript and JavaScript files, 📖 -> https://github.com/TypeStrong/ts-loader
    extensions: ['.ts', '.js'],
    alias: {
      sharp$: path.resolve(__dirname, 'src/utils/mockSharp.js'),
      'onnxruntime-node$': false,
    },
  },
  module: {
    rules: [
      {
        test: /\.ts$/,
        exclude: /node_modules/,
        use: [
          {
            loader: 'ts-loader'
          }
        ]
      },
      {
        test: /(uuid[\\/]dist[\\/].*v35\.js|get-intrinsic[\\/]index\.js|turndown[\\/].*\.js)$/,
        use: [
          {
            loader: path.resolve(__dirname, 'scripts/fix-uuid-loader.js')
          }
        ]
      }
    ]
  },
  plugins: [
    {
      apply: (compiler) => {
        compiler.hooks.afterEmit.tap('CopyGpt3EncoderFiles', () => {
          try {
            ['encoder.json', 'vocab.bpe'].forEach(file => {
              const src = path.join(__dirname, 'node_modules', 'gpt-3-encoder', file);
              const dest = path.join(__dirname, 'dist', file);
              if (fs.existsSync(src)) {
                fs.copyFileSync(src, dest);
              }
            });
          } catch (e) {
            console.error('Failed to copy gpt-3-encoder files', e);
          }
        });
      }
    }
  ],
  devtool: 'nosources-source-map',
  infrastructureLogging: {
    level: "log", // enables logging required for problem matchers
  },
};
module.exports = [ extensionConfig ];