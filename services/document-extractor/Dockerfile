FROM node:24.20.0-bookworm-slim@sha256:ba849c60be29959425b8734d57b8b4b7d56f98edd9504c9af091d5281095a71e
COPY dependencies.sha256 /dependencies.sha256
RUN --mount=type=bind,source=.vendor,target=/vendor cd /vendor && sha256sum -c /dependencies.sha256 && apt-get install -y --no-install-recommends /vendor/debs/*.deb && rm -f /var/cache/apt/archives/*.deb && dpkg-query -W > /package-versions.txt && mkdir -p /opt/tika /opt/compiler && python3 -c "import zipfile; zipfile.ZipFile('/vendor/tika.zip').extractall('/opt/tika')" && cp /vendor/ecj.jar /opt/compiler/ecj.jar
COPY Parser.java /service/Parser.java
RUN mkdir -p /opt/parser && python3 -c "import glob,subprocess; subprocess.run(['java','-jar','/opt/compiler/ecj.jar','-17','-cp',':'.join(glob.glob('/opt/tika/lib/*.jar')+glob.glob('/opt/tika/*.jar')),'-d','/opt/parser','/service/Parser.java'],check=True)"
COPY gateway.py sandbox.py /service/
COPY runtime /service/runtime
COPY tests /service/tests
USER 1000:1000
ENV PYTHONDONTWRITEBYTECODE=1
WORKDIR /service
EXPOSE 8443
CMD ["python3", "-B", "/service/gateway.py"]
