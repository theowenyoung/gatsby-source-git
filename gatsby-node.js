const Git = require("simple-git/promise");
const fastGlob = require("fast-glob");
const fs = require("fs");
const { createFileNode } = require("gatsby-source-filesystem/create-file-node");
const GitUrlParse = require("git-url-parse");

async function isAlreadyCloned(remote, path) {
  try {
    const existingRemote = await Git(path).listRemote(["--get-url"]);
    return existingRemote.trim() == remote.trim();
  } catch (error) {
    console.error('error', error);

    return Promise.resolve(false);
  }

}

async function getTargetBranch(repo, branch) {
  if (typeof branch == `string`) {
    return `origin/${branch}`;
  } else {
    return repo.raw(["symbolic-ref", "--short", "refs/remotes/origin/HEAD"]).then(result => result.trim());
  }
}

async function getRepo(path, remote, branch, options) {
  options = options || []
  // If the directory doesn't exist or is empty, clone. This will be the case if
  // our config has changed because Gatsby trashes the cache dir automatically
  // in that case.

  if (!fs.existsSync(path) || fs.readdirSync(path).length === 0) {
    let opts = [];
    if (typeof branch == `string`) {
      opts.push(`--branch`, branch);
    }
    await Git().clone(remote, path, opts);
    return Git(path);
  } else if (await isAlreadyCloned(remote, path)) {
    try {
      const repo = await Git(path);
      const target = await getTargetBranch(repo, branch);
      // Refresh our shallow clone with the latest commit.

      await repo
        .fetch(options)
        .then(() => repo.reset([`--hard`, target]));
      return repo;
    } catch (error) {
      console.error('git error', error)
    }


  } else {
    throw new Error(`Can't clone to target destination: ${remote}`);
  }
}

exports.sourceNodes = async (
  {
    actions: { createNode },
    store,
    createNodeId,
    createContentDigest,
    reporter
  },
  { name, remote, branch, rootDir,patterns = `**`, local, fetchOptions }
) => {
  const programDir = store.getState().program.directory;
  const parsedRemote = GitUrlParse(remote);
  name = name || parsedRemote.name
  const localPath = local || require("path").join(
    programDir,
    `.cache`,
    `gatsby-source-git`,
    parsedRemote.full_name,
    name
  );
  let repo;
  try {
    repo = await getRepo(localPath, remote, branch, fetchOptions);
  } catch (e) {
    return reporter.error(e);
  }

  parsedRemote.git_suffix = false;
  parsedRemote.webLink = parsedRemote.toString("https");
  delete parsedRemote.git_suffix;
  let ref = await repo.raw(["rev-parse", "--abbrev-ref", "HEAD"]);
  parsedRemote.ref = ref.trim();
  let rootPath = localPath;
  if(rootDir){
    rootPath = path.resolve(localPath,rootDir)
  }
  const repoFiles = await fastGlob(patterns, {
    cwd: rootPath,
    absolute: true
  });

  const remoteId = createNodeId(`git-remote-${name}`);

  // Create a single graph node for this git remote.
  // Filenodes sourced from it will get a field pointing back to it.
  await createNode(
    Object.assign(parsedRemote, {
      id: remoteId,
      sourceInstanceName: name,
      parent: null,
      children: [],
      internal: {
        type: `GitRemote`,
        content: JSON.stringify(parsedRemote),
        contentDigest: createContentDigest(parsedRemote)
      }
    })
  );

  const createAndProcessNode = path => {
    return createFileNode(path, createNodeId, {
      name: name,
      path: localPath
    }).then(fileNode => {
      // Add a link to the git remote node
      fileNode.gitRemote___NODE = remoteId;
      // Then create the node, as if it were created by the gatsby-source
      // filesystem plugin.
      return createNode(fileNode, {
        name: `gatsby-source-filesystem`
      });
    });
  };

  return Promise.all(repoFiles.map(createAndProcessNode));
};

exports.onCreateNode;
