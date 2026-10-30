# UNTESTED draft: build it with rpmbuild/mock or on COPR before relying on it.
%global uuid battguard@YOUR_GITHUB_USERNAME

Name:           battguard
Version:        1.0.0
Release:        1%{?dist}
Summary:        Battery charge limit switch for the Cinnamon panel
License:        MIT
URL:            https://github.com/YOUR_GITHUB_USERNAME/battguard
Source0:        %{url}/archive/v%{version}/%{name}-%{version}.tar.gz
BuildArch:      noarch

Requires:       bash
Requires:       coreutils
Requires:       polkit
Recommends:     cinnamon

%description
BattGuard adds a switch to the Cinnamon panel that turns the laptop battery
charge limit (80%%) on and off. It only works on supported laptops: Acer
Predator and Nitro models running the Linuwu-Sense driver, and laptops whose
kernel exposes charge_control_end_threshold. On other hardware it shows an
explanatory message and changes nothing.

%prep
%autosetup

%build
# Nothing to build.

%install
DESTDIR=%{buildroot} ./install.sh system --prefix %{_prefix}
install -d %{buildroot}%{_datadir}/cinnamon/applets/%{uuid}
cp -a %{uuid}/files/%{uuid}/. %{buildroot}%{_datadir}/cinnamon/applets/%{uuid}/

%check
bash tests/test_helper.sh

%files
%license LICENSE
%doc README.md CHANGELOG.md
%{_libexecdir}/%{name}/
%{_datadir}/polkit-1/actions/io.github.battguard.policy
%{_datadir}/cinnamon/applets/%{uuid}/

# Known limitation: translations (po/*.po) are only compiled by install.sh and
# Cinnamon Spices; this package ships the English interface.

%changelog
* Mon Oct 26 2026 Your Name <you@example.com> - 1.0.0-1
- Initial package
