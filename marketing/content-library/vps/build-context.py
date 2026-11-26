#!/usr/bin/env python3
"""Build a small Docker context without traversing private repository trees."""
import argparse
from pathlib import Path
import shutil

PREFIX = 'marketing/content-library/'
MODULES = ('engine.py', 'factory.py', 'machine.py', 'autonomous.py', 'ops.py', 'preparation.py', 'content_pipeline.py', 'idea_generation.py', 'idea-prompt.md', 'idea-schema.json', 'creative_projects.py', 'creative-project-prompt.md', 'creative-project-schema.json', 'render_sandbox.py',
           'planner.py', 'publisher.py', 'google_sync.py', 'review_queue.py', 'content_review.py',
           'audio_qa.py', 'director.py', 'director-review.schema.json', 'director-prompt.md',
           'creative_verification.py','verification-policy.md','verification-prompt.md',
           'verification-schema.json','verification-repair-prompt.md','verification-repair-schema.json',
           'drive_versions.py','drive_assets.py','feedback.py','feedback_learning.py','feedback_workflow.py','feedback_repair.py','feedback-repair-prompt.md','feedback-repair-schema.json')
DOCUMENTS = ('mea-beclick-kb/content-library.md', 'mea-beclick-kb/creative-video-machine.md',
             'mea-beclick-kb/gtm-operating-model.md',
             *(PREFIX + name for name in ('AUDIO-WORKFLOW.md', 'AUTOMATION-ROADMAP.md', 'MACHINE.md', 'GOOGLE-SYNC.md')))
COMMON = ('meta.json', 'index.html', 'hyperframes.json', 'assets/logo.svg',
          'assets/fonts/heebo-hebrew-wght-normal.woff2',
          'assets/fonts/heebo-latin-wght-normal.woff2', 'assets/gsap.min.js')
TEMPLATES = {
    'ad-parent-paper-sfx': (*COMMON, 'README.md', 'build-audio.py', 'sound-plan.json',
                          'motion.js', 'style.css', 'assets/fonts/Heebo-OFL.txt',
                          'assets/audio/sfx-mix.wav', 'assets/sfx/wood-click.mp3',
                          'assets/sfx/ASSETS.json', 'assets/sfx/page-turn.mp3', 'assets/sfx/CREDITS.md'),
    'riddle-rectangles-v2': (*COMMON, 'package.json', 'compositions/lesson.html'),
    'tip-add18-v2': (*COMMON, 'package.json', 'compositions/lesson.html'),
}
RENDERER_FILES = tuple(PREFIX + 'renderer/' + name for name in ('Dockerfile','run_renderer.py','egress_proxy.py'))
REQUIRED_FILES = tuple(PREFIX + name for name in MODULES) + DOCUMENTS + tuple(
    PREFIX + 'posts/' + template + '/' + file
    for template, files in TEMPLATES.items() for file in files
) + tuple(PREFIX + 'vps/' + name for name in ('Dockerfile', 'compose.yaml', 'package.json',
                                            'package-lock.json', 'run-worker.py', 'README.md', 'build-context.py')) + RENDERER_FILES
OPTIONAL_FILES = tuple(PREFIX + name for name in ('buffer_mcp.py', 'buffer_scheduler.py', 'media_outbox.py'))


def checked_file(root, relative):
    path = root
    for part in Path(relative).parts:
        path = path/part
        if path.is_symlink():
            raise ValueError('Symlink in selected build source: ' + relative)
    if not path.is_file():
        raise ValueError('Missing selected build source: ' + relative)
    return path


def build(root, destination):
    root = Path(root).absolute()
    # Reject symlink ancestors, too; resolve() alone would silently follow them.
    for ancestor in (root, *root.parents):
        if ancestor.is_symlink(): raise ValueError('Symlink repository root')
    destination = Path(destination).absolute()
    if destination.exists(): raise ValueError('Build destination must not exist')
    if destination == root or root in destination.parents:
        raise ValueError('Build destination must be outside the repository')
    paths = list(REQUIRED_FILES)
    for relative in OPTIONAL_FILES:
        candidate=root/relative
        if candidate.exists() or candidate.is_symlink(): paths.append(relative)
    sources = [(relative, checked_file(root, relative)) for relative in paths]
    destination.mkdir(parents=True)
    try:
        for relative, source in sources:
            target = destination/relative
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(source, target)
    except BaseException:
        shutil.rmtree(destination)
        raise
    return len(sources)


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root',type=Path,default=Path(__file__).resolve().parents[3])
    parser.add_argument('--output',type=Path,required=True)
    args=parser.parse_args()
    print(f'Packaged {build(args.root,args.output)} allowlisted files')


if __name__ == '__main__': main()
